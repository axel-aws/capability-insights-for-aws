import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RepositoryAnalyzer, isValidGitHubUrl, parseGitHubUrl, classifyFile, shouldExcludeFile } from './repository-analyzer';

describe('isValidGitHubUrl', () => {
  it('accepts valid GitHub repository URLs', () => {
    expect(isValidGitHubUrl('https://github.com/owner/repo')).toBe(true);
    expect(isValidGitHubUrl('https://github.com/my-org/my-repo')).toBe(true);
    expect(isValidGitHubUrl('https://github.com/user123/project.name')).toBe(true);
    expect(isValidGitHubUrl('https://github.com/org_name/repo_name')).toBe(true);
    expect(isValidGitHubUrl('https://github.com/owner/repo/')).toBe(true);
  });

  it('rejects invalid URLs', () => {
    expect(isValidGitHubUrl('')).toBe(false);
    expect(isValidGitHubUrl('not-a-url')).toBe(false);
    expect(isValidGitHubUrl('http://github.com/owner/repo')).toBe(false);
    expect(isValidGitHubUrl('https://gitlab.com/owner/repo')).toBe(false);
    expect(isValidGitHubUrl('https://github.com/owner')).toBe(false);
    expect(isValidGitHubUrl('https://github.com//repo')).toBe(false);
    expect(isValidGitHubUrl('https://github.com/owner/')).toBe(false);
    expect(isValidGitHubUrl('https://github.com/owner/repo/extra')).toBe(false);
    expect(isValidGitHubUrl('https://github.com/owner/repo/tree/main')).toBe(false);
  });
});

describe('parseGitHubUrl', () => {
  it('extracts owner and repo from valid URLs', () => {
    expect(parseGitHubUrl('https://github.com/aws/aws-cdk')).toEqual({
      owner: 'aws',
      repo: 'aws-cdk',
    });
    expect(parseGitHubUrl('https://github.com/my-org/my-repo')).toEqual({
      owner: 'my-org',
      repo: 'my-repo',
    });
  });

  it('throws for invalid URLs', () => {
    expect(() => parseGitHubUrl('not-a-url')).toThrow(
      'Invalid GitHub repository URL format'
    );
  });
});

describe('RepositoryAnalyzer', () => {
  let analyzer: RepositoryAnalyzer;

  beforeEach(() => {
    analyzer = new RepositoryAnalyzer();
    vi.restoreAllMocks();
  });

  it('throws for invalid GitHub URL', async () => {
    await expect(analyzer.analyze('not-a-url', 'token')).rejects.toThrow(
      'Invalid GitHub repository URL format'
    );
  });

  it('throws for invalid token (401)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 401 })
    );

    await expect(
      analyzer.analyze('https://github.com/owner/repo', 'bad-token')
    ).rejects.toThrow('GitHub token is invalid or expired');
  });

  it('throws for non-existent repository (404)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 404 })
    );

    await expect(
      analyzer.analyze('https://github.com/owner/nonexistent', 'token')
    ).rejects.toThrow('Cannot access repository');
  });

  it('processes Go files to extract API operations', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'internal/service/s3/bucket.go', mode: '100644', type: 'blob', sha: 'def456', url: '' },
      ],
      truncated: false,
    };

    const goFileContent = `
package s3

func resourceBucketCreate(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  conn.CreateBucket(input)
  conn.PutBucketPolicy(input)
  return nil
}
`;

    const fetchMock = vi.spyOn(global, 'fetch');
    // Tree API response
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    // File content response
    fetchMock.mockResolvedValueOnce(
      new Response(goFileContent, { status: 200 })
    );

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    expect(result.apiOperations).toContain('CreateBucket');
    expect(result.apiOperations).toContain('PutBucketPolicy');
  });

  it('processes YAML files with Resources section as CFN templates', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'infra/template.yaml', mode: '100644', type: 'blob', sha: 'def456', url: '' },
      ],
      truncated: false,
    };

    const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
  MyFunction:
    Type: AWS::Lambda::Function
`;

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(yamlContent, { status: 200 })
    );

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    expect(result.cfnResourceTypes).toContain('AWS::S3::Bucket');
    expect(result.cfnResourceTypes).toContain('AWS::Lambda::Function');
    expect(result.serviceNames).toContain('S3');
    expect(result.serviceNames).toContain('Lambda');
  });

  it('processes .tf files to extract Terraform resource types', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'infra/main.tf', mode: '100644', type: 'blob', sha: 'def456', url: '' },
      ],
      truncated: false,
    };

    const tfContent = `
resource "aws_s3_bucket" "example" {
  bucket = "my-bucket"
}

resource "aws_lambda_function" "example" {
  function_name = "my-function"
}
`;

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(tfContent, { status: 200 })
    );

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    expect(result.terraformResourceTypes).toContain('aws_s3_bucket');
    expect(result.terraformResourceTypes).toContain('aws_lambda_function');
  });

  it('aggregates and deduplicates results from multiple files', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'service/s3.go', mode: '100644', type: 'blob', sha: '1', url: '' },
        { path: 'service/s3_policy.go', mode: '100644', type: 'blob', sha: '2', url: '' },
        { path: 'infra/main.tf', mode: '100644', type: 'blob', sha: '3', url: '' },
        { path: 'cfn/template.yaml', mode: '100644', type: 'blob', sha: '4', url: '' },
      ],
      truncated: false,
    };

    const goFile1 = 'conn.CreateBucket(input)\nconn.PutObject(input)';
    const goFile2 = 'conn.CreateBucket(input)\nconn.DeleteBucket(input)';
    const tfFile = 'resource "aws_s3_bucket" "a" {\n  bucket = "test"\n}\n\nresource "aws_lambda_function" "b" {\n  function_name = "test"\n}\n';
    const cfnFile = 'Resources:\n  B:\n    Type: AWS::S3::Bucket\n';

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    // Go files (processed first due to language priority)
    fetchMock.mockResolvedValueOnce(new Response(goFile1, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(goFile2, { status: 200 }));
    // Infra files (processed after SDK files, in tree order: .tf then .yaml)
    fetchMock.mockResolvedValueOnce(new Response(tfFile, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(cfnFile, { status: 200 }));

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    // API operations are deduplicated
    expect(result.apiOperations).toEqual(['CreateBucket', 'DeleteBucket', 'PutObject']);
    // Terraform types are deduplicated
    expect(result.terraformResourceTypes).toEqual(['aws_lambda_function', 'aws_s3_bucket']);
    // CFN types
    expect(result.cfnResourceTypes).toEqual(['AWS::S3::Bucket']);
    // Service names derived from CFN types
    expect(result.serviceNames).toEqual(['S3']);
  });

  it('skips non-blob entries (directories)', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'src', mode: '040000', type: 'tree', sha: '1', url: '' },
        { path: 'src/main.go', mode: '100644', type: 'blob', sha: '2', url: '' },
      ],
      truncated: false,
    };

    const goContent = 'conn.CreateBucket(input)';

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(new Response(goContent, { status: 200 }));

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    expect(result.apiOperations).toEqual(['CreateBucket']);
  });

  it('skips YAML/JSON files without Resources section', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'config.yaml', mode: '100644', type: 'blob', sha: '1', url: '' },
      ],
      truncated: false,
    };

    const yamlContent = 'name: my-app\nversion: 1.0.0\n';

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(new Response(yamlContent, { status: 200 }));

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    expect(result.cfnResourceTypes).toEqual([]);
  });

  it('continues processing when individual files fail to fetch', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'bad.go', mode: '100644', type: 'blob', sha: '1', url: '' },
        { path: 'good.go', mode: '100644', type: 'blob', sha: '2', url: '' },
      ],
      truncated: false,
    };

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    // First file fails
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    // Second file succeeds
    fetchMock.mockResolvedValueOnce(
      new Response('conn.ListBuckets(input)', { status: 200 })
    );

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    expect(result.apiOperations).toEqual(['ListBuckets']);
  });

  it('returns empty capability set for repository with no relevant files', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'README.md', mode: '100644', type: 'blob', sha: '1', url: '' },
        { path: 'package.json', mode: '100644', type: 'blob', sha: '2', url: '' },
      ],
      truncated: false,
    };

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    expect(result.cfnResourceTypes).toEqual([]);
    expect(result.terraformResourceTypes).toEqual([]);
    expect(result.apiOperations).toEqual([]);
    expect(result.serviceNames).toEqual([]);
    expect(result.terraformToCfnMapping).toEqual({});
  });
});


describe('classifyFile', () => {
  it('classifies .go files as go', () => {
    expect(classifyFile('main.go')).toBe('go');
    expect(classifyFile('src/service/handler.go')).toBe('go');
  });

  it('classifies .java files as java', () => {
    expect(classifyFile('App.java')).toBe('java');
    expect(classifyFile('src/main/java/com/example/Service.java')).toBe('java');
  });

  it('classifies .py files as python', () => {
    expect(classifyFile('handler.py')).toBe('python');
    expect(classifyFile('src/lambda/main.py')).toBe('python');
  });

  it('classifies .ts files as typescript', () => {
    expect(classifyFile('index.ts')).toBe('typescript');
    expect(classifyFile('src/handlers/api.ts')).toBe('typescript');
  });

  it('classifies .js files as typescript', () => {
    expect(classifyFile('index.js')).toBe('typescript');
    expect(classifyFile('lib/utils.js')).toBe('typescript');
  });

  it('classifies .yaml files as yaml', () => {
    expect(classifyFile('template.yaml')).toBe('yaml');
    expect(classifyFile('infra/stack.yaml')).toBe('yaml');
  });

  it('classifies .yml files as yaml', () => {
    expect(classifyFile('template.yml')).toBe('yaml');
    expect(classifyFile('config/deploy.yml')).toBe('yaml');
  });

  it('classifies .json files as json', () => {
    expect(classifyFile('template.json')).toBe('json');
    expect(classifyFile('cfn/stack.json')).toBe('json');
  });

  it('classifies .tf files as terraform', () => {
    expect(classifyFile('main.tf')).toBe('terraform');
    expect(classifyFile('modules/vpc/main.tf')).toBe('terraform');
  });

  it('classifies unknown extensions as unknown', () => {
    expect(classifyFile('README.md')).toBe('unknown');
    expect(classifyFile('Makefile')).toBe('unknown');
    expect(classifyFile('image.png')).toBe('unknown');
    expect(classifyFile('data.csv')).toBe('unknown');
    expect(classifyFile('.gitignore')).toBe('unknown');
  });
});

describe('shouldExcludeFile', () => {
  describe('test directory exclusions', () => {
    it('excludes files in test/ directory', () => {
      expect(shouldExcludeFile('test/handler.go')).toBe(true);
      expect(shouldExcludeFile('src/test/Service.java')).toBe(true);
    });

    it('excludes files in tests/ directory', () => {
      expect(shouldExcludeFile('tests/unit/handler.py')).toBe(true);
      expect(shouldExcludeFile('src/tests/integration.ts')).toBe(true);
    });

    it('excludes files in __tests__/ directory', () => {
      expect(shouldExcludeFile('__tests__/app.test.ts')).toBe(true);
      expect(shouldExcludeFile('src/__tests__/handler.ts')).toBe(true);
    });

    it('excludes files in spec/ directory', () => {
      expect(shouldExcludeFile('spec/handler_spec.py')).toBe(true);
      expect(shouldExcludeFile('src/spec/service.java')).toBe(true);
    });
  });

  describe('vendor directory exclusions', () => {
    it('excludes files in vendor/ directory', () => {
      expect(shouldExcludeFile('vendor/github.com/aws/aws-sdk-go/service.go')).toBe(true);
    });

    it('excludes files in node_modules/ directory', () => {
      expect(shouldExcludeFile('node_modules/@aws-sdk/client-s3/index.js')).toBe(true);
    });

    it('excludes files in .venv/ directory', () => {
      expect(shouldExcludeFile('.venv/lib/python3.9/site-packages/boto3/client.py')).toBe(true);
    });

    it('excludes files in site-packages/ directory', () => {
      expect(shouldExcludeFile('lib/python3.9/site-packages/botocore/session.py')).toBe(true);
    });

    it('excludes files in __pycache__/ directory', () => {
      expect(shouldExcludeFile('src/__pycache__/handler.cpython-39.pyc')).toBe(true);
    });

    it('excludes files in target/dependency/ directory', () => {
      expect(shouldExcludeFile('target/dependency/aws-sdk-java.jar')).toBe(true);
    });

    it('excludes files in build/classes/ directory', () => {
      expect(shouldExcludeFile('build/classes/com/example/Service.class')).toBe(true);
    });
  });

  describe('test file pattern exclusions', () => {
    it('excludes files matching _test. pattern', () => {
      expect(shouldExcludeFile('src/handler_test.go')).toBe(true);
      expect(shouldExcludeFile('pkg/service_test.go')).toBe(true);
    });

    it('excludes files matching .test. pattern', () => {
      expect(shouldExcludeFile('src/handler.test.ts')).toBe(true);
      expect(shouldExcludeFile('lib/service.test.js')).toBe(true);
    });

    it('excludes files matching .spec. pattern', () => {
      expect(shouldExcludeFile('src/handler.spec.ts')).toBe(true);
      expect(shouldExcludeFile('lib/service.spec.js')).toBe(true);
    });
  });

  describe('non-excluded files', () => {
    it('does not exclude regular source files', () => {
      expect(shouldExcludeFile('src/handler.go')).toBe(false);
      expect(shouldExcludeFile('src/main/java/com/example/Service.java')).toBe(false);
      expect(shouldExcludeFile('lambda/handler.py')).toBe(false);
      expect(shouldExcludeFile('src/index.ts')).toBe(false);
      expect(shouldExcludeFile('infra/template.yaml')).toBe(false);
    });

    it('does not exclude files where test/vendor is part of the filename', () => {
      expect(shouldExcludeFile('src/test_utils.go')).toBe(false);
      expect(shouldExcludeFile('src/vendor_service.java')).toBe(false);
    });
  });
});

describe('RepositoryAnalyzer - timeout behavior', () => {
  let analyzer: RepositoryAnalyzer;
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    analyzer = new RepositoryAnalyzer();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets timedOut flag when elapsed time exceeds 50 seconds', async () => {
    // Simulate time progression: start at 0, then jump past 50s after first batch
    let callCount = 0;
    dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockImplementation(() => {
      callCount++;
      // First call (start time): 0
      if (callCount <= 1) return 0;
      // Subsequent calls: past the 50s cutoff
      return 51_000;
    });

    const files = [
      { entry: { path: 'a.go', mode: '100644', type: 'blob', sha: '1', url: '' }, language: 'go' as const },
      { entry: { path: 'b.go', mode: '100644', type: 'blob', sha: '2', url: '' }, language: 'go' as const },
      { entry: { path: 'c.go', mode: '100644', type: 'blob', sha: '3', url: '' }, language: 'go' as const },
    ];

    // Mock fetch to return Go file content
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('conn.CreateBucket(input)', { status: 200 })
    );

    const result = await analyzer.fetchAndProcessFiles(files, 'owner', 'repo', 'token');

    expect(result.timedOut).toBe(true);
    expect(result.totalFilesIdentified).toBe(3);
  });

  it('returns partial result with correct counts when timeout occurs', async () => {
    // Start at 0, stay under 50s for first batch, then exceed for second batch
    let callCount = 0;
    dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return 0; // start time + first timeout check
      return 51_000; // after first batch completes, exceed timeout
    });

    // Create more files than one batch (MAX_CONCURRENCY = 15)
    const files = Array.from({ length: 20 }, (_, i) => ({
      entry: { path: `file${i}.go`, mode: '100644', type: 'blob', sha: `${i}`, url: '' },
      language: 'go' as const,
    }));

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('conn.ListBuckets(input)', { status: 200 })
    );

    const result = await analyzer.fetchAndProcessFiles(files, 'owner', 'repo', 'token');

    expect(result.timedOut).toBe(true);
    expect(result.totalFilesIdentified).toBe(20);
    // First batch of 15 should have been processed
    expect(result.filesProcessed).toBe(15);
  });

  it('does not set timedOut when processing completes within 50 seconds', async () => {
    dateNowSpy = vi.spyOn(Date, 'now');
    // Always return a time well under 50s
    dateNowSpy.mockReturnValue(0);

    const files = [
      { entry: { path: 'a.go', mode: '100644', type: 'blob', sha: '1', url: '' }, language: 'go' as const },
      { entry: { path: 'b.go', mode: '100644', type: 'blob', sha: '2', url: '' }, language: 'go' as const },
    ];

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('conn.PutObject(input)', { status: 200 })
    );

    const result = await analyzer.fetchAndProcessFiles(files, 'owner', 'repo', 'token');

    expect(result.timedOut).toBe(false);
    expect(result.filesProcessed).toBe(2);
    expect(result.totalFilesIdentified).toBe(2);
  });

  it('sets partialResult on CapabilitySet when timeout occurs during analyze', async () => {
    let callCount = 0;
    dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return 0;
      return 51_000;
    });

    // Create a tree with many files to trigger timeout
    const tree = Array.from({ length: 20 }, (_, i) => ({
      path: `src/file${i}.go`,
      mode: '100644',
      type: 'blob',
      sha: `${i}`,
      url: '',
    }));

    const treeResponse = { sha: 'abc', url: '', tree, truncated: false };

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    // All file fetches return Go content
    for (let i = 0; i < 20; i++) {
      fetchMock.mockResolvedValueOnce(
        new Response('conn.CreateBucket(input)', { status: 200 })
      );
    }

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    expect(result.partialResult).toBeDefined();
    expect(result.partialResult!.isPartial).toBe(true);
    expect(result.partialResult!.totalFilesIdentified).toBe(20);
    expect(result.partialResult!.filesProcessed).toBeGreaterThan(0);
    expect(result.partialResult!.filesProcessed).toBeLessThan(20);
  });
});

describe('RepositoryAnalyzer - language priority ordering', () => {
  let analyzer: RepositoryAnalyzer;

  beforeEach(() => {
    analyzer = new RepositoryAnalyzer();
    vi.restoreAllMocks();
  });

  it('processes Go files before Java, Python, and TypeScript files', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'src/handler.ts', mode: '100644', type: 'blob', sha: '1', url: '' },
        { path: 'src/handler.py', mode: '100644', type: 'blob', sha: '2', url: '' },
        { path: 'src/Handler.java', mode: '100644', type: 'blob', sha: '3', url: '' },
        { path: 'src/handler.go', mode: '100644', type: 'blob', sha: '4', url: '' },
      ],
      truncated: false,
    };

    const fetchOrder: string[] = [];
    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );

    // Track the order of file content fetches
    fetchMock.mockImplementation(async (url) => {
      const urlStr = url instanceof Request ? url.url : url.toString();
      if (urlStr.includes('/contents/')) {
        const path = urlStr.split('/contents/')[1];
        fetchOrder.push(path);
      }
      return new Response('', { status: 200 });
    });

    await analyzer.analyze('https://github.com/owner/repo', 'token');

    // Go should be first, then Java, then Python, then TypeScript
    const goIdx = fetchOrder.findIndex(p => p.endsWith('.go'));
    const javaIdx = fetchOrder.findIndex(p => p.endsWith('.java'));
    const pyIdx = fetchOrder.findIndex(p => p.endsWith('.py'));
    const tsIdx = fetchOrder.findIndex(p => p.endsWith('.ts'));

    expect(goIdx).toBeLessThan(javaIdx);
    expect(javaIdx).toBeLessThan(pyIdx);
    expect(pyIdx).toBeLessThan(tsIdx);
  });
});

describe('RepositoryAnalyzer - cross-language deduplication', () => {
  let analyzer: RepositoryAnalyzer;

  beforeEach(() => {
    analyzer = new RepositoryAnalyzer();
    vi.restoreAllMocks();
  });

  it('deduplicates same operation from multiple languages into single entry', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'src/service.go', mode: '100644', type: 'blob', sha: '1', url: '' },
        { path: 'src/Service.java', mode: '100644', type: 'blob', sha: '2', url: '' },
        { path: 'src/service.py', mode: '100644', type: 'blob', sha: '3', url: '' },
        { path: 'src/service.ts', mode: '100644', type: 'blob', sha: '4', url: '' },
      ],
      truncated: false,
    };

    // Go: PutObject (already PascalCase)
    const goContent = 'conn.PutObject(input)';
    // Java: putObject → PutObject
    const javaContent = 's3Client.putObject(request);';
    // Python: put_object → PutObject
    const pyContent = 's3_client.put_object(Bucket="b")';
    // TypeScript: new PutObjectCommand( → PutObject
    const tsContent = 'await client.send(new PutObjectCommand(params));';

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    // Files are fetched in priority order: Go, Java, Python, TS
    fetchMock.mockResolvedValueOnce(new Response(goContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(javaContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(pyContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(tsContent, { status: 200 }));

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    // PutObject should appear exactly once despite being in all 4 languages
    expect(result.apiOperations.filter(op => op === 'PutObject')).toHaveLength(1);
    expect(result.apiOperations).toContain('PutObject');
  });

  it('keeps distinct operations from different languages', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'src/s3.go', mode: '100644', type: 'blob', sha: '1', url: '' },
        { path: 'src/DynamoService.java', mode: '100644', type: 'blob', sha: '2', url: '' },
        { path: 'src/lambda_handler.py', mode: '100644', type: 'blob', sha: '3', url: '' },
      ],
      truncated: false,
    };

    const goContent = 'conn.CreateBucket(input)';
    const javaContent = 'dynamoDbClient.getItem(request);';
    const pyContent = 'lambda_client.invoke(FunctionName="f")';

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    fetchMock.mockResolvedValueOnce(new Response(goContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(javaContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(pyContent, { status: 200 }));

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    expect(result.apiOperations).toContain('CreateBucket');
    expect(result.apiOperations).toContain('GetItem');
    expect(result.apiOperations).toContain('Invoke');
    expect(result.apiOperations).toHaveLength(3);
  });
});

describe('RepositoryAnalyzer - mixed-language repository aggregation', () => {
  let analyzer: RepositoryAnalyzer;

  beforeEach(() => {
    analyzer = new RepositoryAnalyzer();
    vi.restoreAllMocks();
  });

  it('aggregates operations from Go, Java, Python, TS, CFN, and Terraform files', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'src/s3.go', mode: '100644', type: 'blob', sha: '1', url: '' },
        { path: 'src/DynamoService.java', mode: '100644', type: 'blob', sha: '2', url: '' },
        { path: 'src/handler.py', mode: '100644', type: 'blob', sha: '3', url: '' },
        { path: 'src/client.ts', mode: '100644', type: 'blob', sha: '4', url: '' },
        { path: 'infra/template.yaml', mode: '100644', type: 'blob', sha: '5', url: '' },
        { path: 'infra/main.tf', mode: '100644', type: 'blob', sha: '6', url: '' },
      ],
      truncated: false,
    };

    const goContent = 'conn.CreateBucket(input)\nconn.ListBuckets(input)';
    const javaContent = 'dynamoDbClient.getItem(request);\ndynamoDbClient.putItem(request);';
    const pyContent = 's3_client.delete_object(Bucket="b", Key="k")';
    const tsContent = 'await client.send(new InvokeCommand(params));';
    const cfnContent = 'Resources:\n  Bucket:\n    Type: AWS::S3::Bucket\n  Table:\n    Type: AWS::DynamoDB::Table\n';
    const tfContent = 'resource "aws_lambda_function" "fn" {\n  function_name = "test"\n}\n';

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    // SDK files in priority order: Go, Java, Python, TS
    fetchMock.mockResolvedValueOnce(new Response(goContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(javaContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(pyContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(tsContent, { status: 200 }));
    // Infra files after SDK files
    fetchMock.mockResolvedValueOnce(new Response(cfnContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(tfContent, { status: 200 }));

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    // API operations from all SDK languages
    expect(result.apiOperations).toContain('CreateBucket');
    expect(result.apiOperations).toContain('ListBuckets');
    expect(result.apiOperations).toContain('GetItem');
    expect(result.apiOperations).toContain('PutItem');
    expect(result.apiOperations).toContain('DeleteObject');
    expect(result.apiOperations).toContain('Invoke');

    // CFN resource types
    expect(result.cfnResourceTypes).toContain('AWS::S3::Bucket');
    expect(result.cfnResourceTypes).toContain('AWS::DynamoDB::Table');

    // Terraform resource types
    expect(result.terraformResourceTypes).toContain('aws_lambda_function');

    // Service names derived from CFN
    expect(result.serviceNames).toContain('S3');
    expect(result.serviceNames).toContain('DynamoDB');

    // No partial result since no timeout
    expect(result.partialResult).toBeUndefined();
  });

  it('excludes test and vendor files from mixed-language repositories', async () => {
    const treeResponse = {
      sha: 'abc123',
      url: 'https://api.github.com/repos/owner/repo/git/trees/abc123',
      tree: [
        { path: 'src/handler.go', mode: '100644', type: 'blob', sha: '1', url: '' },
        { path: 'test/handler_test.go', mode: '100644', type: 'blob', sha: '2', url: '' },
        { path: 'src/Service.java', mode: '100644', type: 'blob', sha: '3', url: '' },
        { path: 'vendor/aws-sdk/Client.java', mode: '100644', type: 'blob', sha: '4', url: '' },
        { path: 'src/handler.py', mode: '100644', type: 'blob', sha: '5', url: '' },
        { path: 'src/handler.test.ts', mode: '100644', type: 'blob', sha: '6', url: '' },
        { path: 'src/client.ts', mode: '100644', type: 'blob', sha: '7', url: '' },
        { path: 'node_modules/@aws-sdk/client-s3/index.js', mode: '100644', type: 'blob', sha: '8', url: '' },
      ],
      truncated: false,
    };

    const goContent = 'conn.CreateBucket(input)';
    const javaContent = 's3Client.putObject(request);';
    const pyContent = 's3_client.list_objects(Bucket="b")';
    const tsContent = 'await client.send(new GetObjectCommand(params));';

    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(treeResponse), { status: 200 })
    );
    // Only non-excluded files should be fetched (4 files: handler.go, Service.java, handler.py, client.ts)
    fetchMock.mockResolvedValueOnce(new Response(goContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(javaContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(pyContent, { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(tsContent, { status: 200 }));

    const result = await analyzer.analyze('https://github.com/owner/repo', 'token');

    expect(result.apiOperations).toContain('CreateBucket');
    expect(result.apiOperations).toContain('PutObject');
    expect(result.apiOperations).toContain('ListObjects');
    expect(result.apiOperations).toContain('GetObject');
    expect(result.apiOperations).toHaveLength(4);
  });
});
