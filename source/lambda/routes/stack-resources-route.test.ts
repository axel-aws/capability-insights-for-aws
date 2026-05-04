import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { corsHeaders } from '../types/api';
import { StatusCode } from '../constants/status-codes';

const { mockListStackResourceTypes, mockGetTemplate, mockGetObject } = vi.hoisted(() => ({
  mockListStackResourceTypes: vi.fn(),
  mockGetTemplate: vi.fn(),
  mockGetObject: vi.fn(),
}));

vi.mock('../services/cloudformation-client', () => ({
  CloudFormationServiceClient: vi.fn().mockImplementation(() => ({
    listStackResourceTypes: mockListStackResourceTypes,
    getTemplate: mockGetTemplate,
  })),
}));

vi.mock('../services/s3-client', () => ({
  S3BucketClient: vi.fn().mockImplementation(() => ({
    getObject: mockGetObject,
  })),
}));

const dummyEvent = {} as APIGatewayProxyEvent;

describe('stackResourcesRoute', () => {
  let stackResourcesRoute: (
    event: APIGatewayProxyEvent,
    params: Record<string, string>,
  ) => Promise<APIGatewayProxyResult>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.WEBSITE_BUCKET_NAME = 'test-bucket';
    const mod = await import('./stack-resources-route');
    stackResourcesRoute = mod.stackResourcesRoute;
  });

  it('returns 200 with resource type pairs and property matches on success', async () => {
    mockListStackResourceTypes.mockResolvedValueOnce(['AWS::EC2::Instance', 'AWS::S3::Bucket']);

    const cfnResources = [
      {
        serviceName: 'EC2',
        resourceTypes: [
          {
            resourceTypeName: 'Instance',
            resourceTypeHomepage: '',
            regionalAvailability: {},
            resourceProperties: [
              {
                resourcePropertyName: 'InstanceType',
                resourceConfigurations: [{ resourceConfigurationName: 't3.micro', regionalAvailability: {} }],
              },
            ],
          },
        ],
      },
    ];
    mockGetObject.mockResolvedValueOnce(JSON.stringify(cfnResources));

    const template = {
      Resources: {
        MyInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            InstanceType: 't3.micro',
          },
        },
        MyBucket: {
          Type: 'AWS::S3::Bucket',
          Properties: {},
        },
      },
    };
    mockGetTemplate.mockResolvedValueOnce(JSON.stringify(template));

    const result = await stackResourcesRoute(dummyEvent, { stackName: 'my-stack' });

    expect(result.statusCode).toBe(StatusCode.OK);
    expect(result.headers).toEqual(corsHeaders);

    const body = JSON.parse(result.body);
    expect(body.resourceTypePairs).toEqual([
      { serviceName: 'EC2', resourceTypeName: 'Instance' },
      { serviceName: 'S3', resourceTypeName: 'Bucket' },
    ]);
    expect(body.propertyMatches).toEqual([
      {
        serviceName: 'EC2',
        resourceTypeName: 'Instance',
        propertyName: 'InstanceType',
        value: 't3.micro',
      },
    ]);
    expect(body.warning).toBeUndefined();
  });

  it('returns 404 when stack does not exist', async () => {
    const cfnError = new Error(
      "Failed to list stack resources for 'no-such-stack': ValidationError: Stack with id no-such-stack does not exist",
    );
    // The CloudFormation client wraps the original error. The route's isStackNotFoundError
    // checks the outer error's name and message. The wrapper Error from cloudformation-client.ts
    // has name 'Error' by default, but the route checks for 'ValidationError' name.
    // Looking at the route code: it catches the error thrown by listStackResourceTypes,
    // which wraps the SDK error. The route's isStackNotFoundError checks error.name === 'ValidationError'.
    // The cloudformation-client wraps errors as `new Error(...)`, so name is 'Error'.
    // But the task instructions say: "the error thrown by listStackResourceTypes should have
    // name: 'ValidationError' and a message containing 'does not exist'".
    cfnError.name = 'ValidationError';

    mockListStackResourceTypes.mockRejectedValueOnce(cfnError);

    const result = await stackResourcesRoute(dummyEvent, { stackName: 'no-such-stack' });

    expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Not Found');
    expect(body.message).toContain('no-such-stack');
    expect(result.headers).toEqual(corsHeaders);
  });

  it('returns 200 with warning when GetTemplate fails (graceful degradation)', async () => {
    mockListStackResourceTypes.mockResolvedValueOnce(['AWS::EC2::Instance']);

    const cfnResources = [
      {
        serviceName: 'EC2',
        resourceTypes: [
          {
            resourceTypeName: 'Instance',
            resourceTypeHomepage: '',
            regionalAvailability: {},
            resourceProperties: [
              {
                resourcePropertyName: 'InstanceType',
                resourceConfigurations: [{ resourceConfigurationName: 't3.micro', regionalAvailability: {} }],
              },
            ],
          },
        ],
      },
    ];
    mockGetObject.mockResolvedValueOnce(JSON.stringify(cfnResources));
    mockGetTemplate.mockRejectedValueOnce(new Error('Access denied'));

    const result = await stackResourcesRoute(dummyEvent, { stackName: 'my-stack' });

    expect(result.statusCode).toBe(StatusCode.OK);
    const body = JSON.parse(result.body);
    expect(body.resourceTypePairs).toEqual([{ serviceName: 'EC2', resourceTypeName: 'Instance' }]);
    expect(body.propertyMatches).toEqual([]);
    expect(body.warning).toContain('Could not retrieve template');
    expect(result.headers).toEqual(corsHeaders);
  });

  it('returns 200 with warning when cfn_resources.json read fails (graceful degradation)', async () => {
    mockListStackResourceTypes.mockResolvedValueOnce(['AWS::S3::Bucket']);
    mockGetObject.mockRejectedValueOnce(new Error('NoSuchKey'));

    const result = await stackResourcesRoute(dummyEvent, { stackName: 'my-stack' });

    expect(result.statusCode).toBe(StatusCode.OK);
    const body = JSON.parse(result.body);
    expect(body.resourceTypePairs).toEqual([{ serviceName: 'S3', resourceTypeName: 'Bucket' }]);
    expect(body.propertyMatches).toEqual([]);
    expect(body.warning).toContain('Could not read capability data');
    expect(result.headers).toEqual(corsHeaders);
    // GetTemplate should NOT be called when property mapping is unavailable
    expect(mockGetTemplate).not.toHaveBeenCalled();
  });

  it('returns 400 when stackName is missing', async () => {
    const result = await stackResourcesRoute(dummyEvent, {});

    expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Bad Request');
    expect(body.message).toContain('Stack name is required');
    expect(result.headers).toEqual(corsHeaders);
  });

  it('returns 500 when listStackResourceTypes fails with a non-stack-not-found error', async () => {
    mockListStackResourceTypes.mockRejectedValueOnce(new Error('Throttling'));

    const result = await stackResourcesRoute(dummyEvent, { stackName: 'my-stack' });

    expect(result.statusCode).toBe(StatusCode.INTERNAL_SERVER_ERROR);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Internal Server Error');
    expect(result.headers).toEqual(corsHeaders);
  });
});
