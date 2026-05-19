#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
source "$SCRIPT_DIR/check-deps.sh"

CONFIG_FILE="$SCRIPT_DIR/deploy-config.yaml"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     Capability Insights — Quickstart Deploy     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# --- Load config ---
CONFIG_SOURCE_ACCESS_POINT_ARN=""
CONFIG_SOURCE_FOLDERS=""

if [[ -f "$CONFIG_FILE" ]]; then
  echo "  Loading config from deploy-config.yaml..."
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    key=$(echo "$line" | sed 's/^\([^:]*\):.*/\1/' | xargs)
    value=$(echo "$line" | sed 's/^[^:]*:[[:space:]]*//' | xargs)
    [[ -z "$value" ]] && continue
    case "$key" in
      source_access_point_arn) CONFIG_SOURCE_ACCESS_POINT_ARN="$value" ;;
      source_folders)          CONFIG_SOURCE_FOLDERS="$value" ;;
    esac
  done < "$CONFIG_FILE"
fi

# --- Prompt for missing values ---
DEFAULT_ACCESS_POINT="arn:aws:s3:us-east-1:686591367145:accesspoint/aws-capabilities-public"

if [[ -z "$CONFIG_SOURCE_ACCESS_POINT_ARN" ]]; then
  echo ""
  echo "  No source_access_point_arn found in deploy-config.yaml."
  read -rp "  S3 Access Point ARN (default: $DEFAULT_ACCESS_POINT): " CONFIG_SOURCE_ACCESS_POINT_ARN
  if [[ -z "$CONFIG_SOURCE_ACCESS_POINT_ARN" ]]; then
    CONFIG_SOURCE_ACCESS_POINT_ARN="$DEFAULT_ACCESS_POINT"
  fi
fi

if [[ -z "$CONFIG_SOURCE_FOLDERS" ]]; then
  read -rp "  Source folders (comma-separated, default: public): " CONFIG_SOURCE_FOLDERS
  if [[ -z "$CONFIG_SOURCE_FOLDERS" ]]; then
    CONFIG_SOURCE_FOLDERS="public"
  fi
fi

echo ""
echo "  Access Point: $CONFIG_SOURCE_ACCESS_POINT_ARN"
echo "  Folders:      $CONFIG_SOURCE_FOLDERS"
echo ""

# --- Step 1: Build ---
echo "── Step 1/3: Building project ──"
cd "$ROOT_DIR"
npm run build
echo "  ✓ Build complete"
echo ""

# --- Step 2: Deploy sample environment ---
echo "── Step 2/3: Deploying sample environment ──"
cd "$ROOT_DIR/source/constructs"
npx cdk bootstrap
npx cdk --app "node dist/bin/dev" deploy CapabilityInsightsSampleEnvironment --require-approval never
echo "  ✓ Sample environment deployed"
echo ""

# --- Step 3: Deploy Capability Insights using sample environment outputs ---
echo "── Step 3/3: Deploying Capability Insights ──"

get_stack_output() {
  aws cloudformation describe-stacks --stack-name CapabilityInsightsSampleEnvironment \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

PRIVATE_VPC_ID=$(get_stack_output "PrivateVpcId")
BACKEND_SUBNET_ID=$(get_stack_output "BackendSubnetId")
API_ACCESS_SUBNET_ID=$(get_stack_output "ApiAccessSubnetId")
DEPLOYMENT_ASSETS_BUCKET_NAME=$(get_stack_output "DeploymentAssetsBucketName")

if [[ -z "$PRIVATE_VPC_ID" || -z "$BACKEND_SUBNET_ID" || -z "$API_ACCESS_SUBNET_ID" || -z "$DEPLOYMENT_ASSETS_BUCKET_NAME" ]]; then
  echo "  ✗ Could not read sample environment outputs."
  exit 1
fi

echo "  VPC:              $PRIVATE_VPC_ID"
echo "  Backend Subnet:   $BACKEND_SUBNET_ID"
echo "  API Subnet:       $API_ACCESS_SUBNET_ID"
echo "  Assets Bucket:    $DEPLOYMENT_ASSETS_BUCKET_NAME"
echo ""

"$SCRIPT_DIR/deploy.sh" deploy \
  --private-vpc-id "$PRIVATE_VPC_ID" \
  --backend-subnet-id "$BACKEND_SUBNET_ID" \
  --api-access-subnet-id "$API_ACCESS_SUBNET_ID" \
  --deployment-assets-bucket-name "$DEPLOYMENT_ASSETS_BUCKET_NAME" \
  --source-access-point-arn "$CONFIG_SOURCE_ACCESS_POINT_ARN" \
  --source-folders "$CONFIG_SOURCE_FOLDERS" \
  --yes

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║          ✓ Quickstart deploy complete!          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "── Opening browser via SSM proxy ──"
"$SCRIPT_DIR/browse.sh"
