import { describe, it, expect } from 'vitest';
import { parseTerraformTemplate } from './terraform-template-parser';

/**
 * Unit tests for Terraform template parser.
 * Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 11.1, 11.2, 11.5, 11.6
 */

describe('parseTerraformTemplate', () => {
  describe('basic resource extraction', () => {
    it('should extract aws_* resource types from a simple template', () => {
      const content = `
resource "aws_s3_bucket" "my_bucket" {
  bucket = "my-bucket"
}

resource "aws_lambda_function" "my_function" {
  function_name = "my-function"
}
`;
      const result = parseTerraformTemplate(content);
      expect(result).toEqual(['aws_lambda_function', 'aws_s3_bucket']);
    });

    it('should extract awscc_* resource types', () => {
      const content = `
resource "awscc_s3_bucket" "my_bucket" {
  bucket_name = "my-bucket"
}

resource "awscc_lambda_function" "my_function" {
  function_name = "my-function"
}
`;
      const result = parseTerraformTemplate(content);
      expect(result).toEqual(['awscc_lambda_function', 'awscc_s3_bucket']);
    });

    it('should extract both aws_* and awscc_* types from the same template', () => {
      const content = `
resource "aws_s3_bucket" "bucket1" {
  bucket = "bucket1"
}

resource "awscc_dynamodb_table" "table1" {
  table_name = "table1"
}
`;
      const result = parseTerraformTemplate(content);
      expect(result).toEqual(['aws_s3_bucket', 'awscc_dynamodb_table']);
    });
  });

  describe('data block exclusion', () => {
    it('should ignore data blocks and only extract resource blocks', () => {
      const content = `
data "aws_ami" "ubuntu" {
  most_recent = true
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
}

data "aws_vpc" "default" {
  default = true
}
`;
      const result = parseTerraformTemplate(content);
      expect(result).toEqual(['aws_instance']);
    });

    it('should handle data blocks with same type as resource blocks', () => {
      const content = `
data "aws_s3_bucket" "existing" {
  bucket = "existing-bucket"
}

resource "aws_s3_bucket" "new_bucket" {
  bucket = "new-bucket"
}
`;
      const result = parseTerraformTemplate(content);
      expect(result).toEqual(['aws_s3_bucket']);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate resource types', () => {
      const content = `
resource "aws_s3_bucket" "bucket1" {
  bucket = "bucket1"
}

resource "aws_s3_bucket" "bucket2" {
  bucket = "bucket2"
}

resource "aws_s3_bucket" "bucket3" {
  bucket = "bucket3"
}
`;
      const result = parseTerraformTemplate(content);
      expect(result).toEqual(['aws_s3_bucket']);
    });
  });

  describe('sorting', () => {
    it('should return results in sorted order', () => {
      const content = `
resource "aws_vpc" "main" {}
resource "aws_s3_bucket" "bucket" {}
resource "aws_lambda_function" "fn" {}
resource "aws_dynamodb_table" "table" {}
resource "aws_iam_role" "role" {}
`;
      const result = parseTerraformTemplate(content);
      expect(result).toEqual([
        'aws_dynamodb_table',
        'aws_iam_role',
        'aws_lambda_function',
        'aws_s3_bucket',
        'aws_vpc',
      ]);
    });
  });

  describe('non-AWS resource filtering', () => {
    it('should filter out non-AWS resource types', () => {
      const content = `
resource "aws_s3_bucket" "bucket" {
  bucket = "my-bucket"
}

resource "google_compute_instance" "vm" {
  name = "my-vm"
}

resource "azurerm_resource_group" "rg" {
  name = "my-rg"
}

resource "null_resource" "example" {}
`;
      const result = parseTerraformTemplate(content);
      expect(result).toEqual(['aws_s3_bucket']);
    });
  });

  describe('error handling', () => {
    it('should throw an error for empty content', () => {
      expect(() => parseTerraformTemplate('')).toThrow(
        'Failed to parse Terraform template: content is empty'
      );
    });

    it('should throw an error for whitespace-only content', () => {
      expect(() => parseTerraformTemplate('   \n\t  ')).toThrow(
        'Failed to parse Terraform template: content is empty'
      );
    });

    it('should throw an error when no AWS resource blocks are found', () => {
      const content = `
variable "region" {
  default = "us-east-1"
}

provider "aws" {
  region = var.region
}
`;
      expect(() => parseTerraformTemplate(content)).toThrow(
        'No AWS resources found in Terraform template'
      );
    });

    it('should throw an error when only non-AWS resource blocks exist', () => {
      const content = `
resource "null_resource" "example" {
  triggers = {}
}

resource "random_id" "server" {
  byte_length = 8
}
`;
      expect(() => parseTerraformTemplate(content)).toThrow(
        'No AWS resources found in Terraform template'
      );
    });

    it('should throw an error when only data blocks exist', () => {
      const content = `
data "aws_ami" "ubuntu" {
  most_recent = true
}

data "aws_vpc" "default" {
  default = true
}
`;
      expect(() => parseTerraformTemplate(content)).toThrow(
        'No AWS resources found in Terraform template'
      );
    });
  });

  describe('complex templates', () => {
    it('should handle a realistic multi-resource template', () => {
      const content = `
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_security_group" "allow_tls" {
  name        = "allow_tls"
  vpc_id      = aws_vpc.main.id
}

resource "aws_instance" "web" {
  ami           = "ami-12345678"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.public.id
}

resource "aws_s3_bucket" "logs" {
  bucket = "my-logs-bucket"
}

resource "aws_dynamodb_table" "state" {
  name         = "terraform-state"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
`;
      const result = parseTerraformTemplate(content);
      expect(result).toEqual([
        'aws_dynamodb_table',
        'aws_instance',
        'aws_s3_bucket',
        'aws_security_group',
        'aws_subnet',
        'aws_vpc',
      ]);
    });

    it('should handle resource blocks with varying whitespace', () => {
      const content = `
resource   "aws_s3_bucket"   "bucket1" {
  bucket = "bucket1"
}

resource	"aws_lambda_function"	"fn1" {
  function_name = "fn1"
}

resource "aws_iam_role"
  "role1" {
  name = "role1"
}
`;
      const result = parseTerraformTemplate(content);
      // The regex uses \s+ which matches tabs and multiple spaces
      expect(result).toContain('aws_s3_bucket');
      expect(result).toContain('aws_lambda_function');
    });

    it('should handle module blocks without extracting them as resources', () => {
      const content = `
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
}

resource "aws_s3_bucket" "bucket" {
  bucket = "my-bucket"
}
`;
      const result = parseTerraformTemplate(content);
      expect(result).toEqual(['aws_s3_bucket']);
    });
  });
});
