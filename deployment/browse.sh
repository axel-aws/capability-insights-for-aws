#!/bin/bash
set -e

usage() {
  cat <<EOF
Usage: $0 [options]

Open the Capability Insights website in Chrome via an SSM SOCKS proxy.

Options:
  --profile <name>   AWS CLI profile to use (default: \$AWS_PROFILE or none)
  --port <number>    Local SOCKS proxy port (default: 8080)

Examples:
  $0
  $0 --profile my-profile
  $0 --port 9090

EOF
  exit 1
}

cleanup() {
  [[ -n "$TEMP_DIR" ]] && rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

LOCAL_PORT="8080"
PROFILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)  PROFILE="$2"; shift 2 ;;
    --port)     LOCAL_PORT="$2"; shift 2 ;;
    -h|--help)  usage ;;
    *)          echo "Unknown option: $1"; usage ;;
  esac
done

# Load profile from deploy-config.yaml if not specified via flag or env
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "$PROFILE" && -z "$AWS_PROFILE" ]]; then
  CONFIG_FILE="$SCRIPT_DIR/deploy-config.yaml"
  if [[ -f "$CONFIG_FILE" ]]; then
    CONFIG_PROFILE=$(grep '^aws_profile:' "$CONFIG_FILE" | sed 's/^aws_profile:[[:space:]]*//' | xargs)
    if [[ -n "$CONFIG_PROFILE" ]]; then
      PROFILE="$CONFIG_PROFILE"
    fi
  fi
fi

# Build the --profile flag used in all AWS CLI calls
PROFILE_FLAG=""
if [[ -n "$PROFILE" ]]; then
  export AWS_PROFILE="$PROFILE"
  PROFILE_FLAG="--profile $PROFILE"
elif [[ -n "$AWS_PROFILE" ]]; then
  PROFILE="$AWS_PROFILE"
  PROFILE_FLAG="--profile $AWS_PROFILE"
fi

# Minimal dependency check
for cmd in aws session-manager-plugin ssh; do
  command -v "$cmd" &>/dev/null || {
    if [[ "$cmd" == "session-manager-plugin" ]]; then
      echo "Error: Session Manager plugin is not installed."
      echo "Install it with: brew install --cask session-manager-plugin"
    else
      echo "Error: '$cmd' is not installed."
    fi
    exit 1
  }
done

CALLER_IDENTITY=$(aws sts get-caller-identity --output json $PROFILE_FLAG 2>&1) || {
  echo "Error: AWS credentials are invalid or expired. Refresh them and try again."
  exit 1
}
AWS_ACCOUNT=$(echo "$CALLER_IDENTITY" | grep -o '"Account": "[^"]*"' | cut -d'"' -f4)
AWS_REGION=$(aws configure get region $PROFILE_FLAG 2>/dev/null || echo "us-east-1")
echo "── AWS: account $AWS_ACCOUNT, region $AWS_REGION${PROFILE:+ (profile: $PROFILE)} ──"

INSTANCE_TAG="CapabilityInsightsSampleEnvironmentVpcPublicSubnetLinuxInstance"
MAIN_STACK="CapabilityInsightsForAWS"

# Get website URL from CloudFormation output
echo "── Reading website URL from $MAIN_STACK stack ──"
WEBSITE_URL=$(aws cloudformation describe-stacks --stack-name "$MAIN_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='WebsiteUrl'].OutputValue" \
  --output text $PROFILE_FLAG 2>/dev/null)

if [[ -z "$WEBSITE_URL" || "$WEBSITE_URL" == "None" ]]; then
  echo "  WebsiteUrl output not found, constructing from account/region."
  WEBSITE_URL="http://capability-insights-website-${AWS_ACCOUNT}-${AWS_REGION}.s3-website.${AWS_REGION}.amazonaws.com"
fi
echo "  $WEBSITE_URL"

# Find the EC2 instance
echo "── Finding EC2 instance ──"
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=$INSTANCE_TAG" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text $PROFILE_FLAG 2>/dev/null)

if [[ -z "$INSTANCE_ID" || "$INSTANCE_ID" == "None" ]]; then
  echo "Error: Could not find a running EC2 instance with tag '$INSTANCE_TAG'."
  echo "Make sure you've deployed the sample environment with: npm run dev:setup"
  exit 1
fi
echo "  Instance: $INSTANCE_ID"

# Verify SSM can reach the instance
echo "── Checking SSM connectivity ──"
SSM_STATUS=$(aws ssm describe-instance-information \
  --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
  --query "InstanceInformationList[0].PingStatus" \
  --output text $PROFILE_FLAG 2>/dev/null)

if [[ "$SSM_STATUS" != "Online" ]]; then
  echo "Error: Instance $INSTANCE_ID is not reachable via SSM (status: ${SSM_STATUS:-not registered})."
  echo ""
  echo "Troubleshooting:"
  echo "  - The instance may need a few minutes after launch to register with SSM."
  echo "  - Ensure the instance has internet access (public subnet with internet gateway)."
  echo "  - Check the instance's IAM role has the AmazonSSMManagedInstanceCore policy."
  exit 1
fi
echo "  ✓ Instance is online"

# Kill any existing proxy on the same port
if lsof -ti :"$LOCAL_PORT" &>/dev/null; then
  echo "── Stopping existing proxy on port $LOCAL_PORT ──"
  kill $(lsof -ti :"$LOCAL_PORT") 2>/dev/null || true
  sleep 1
fi

# Generate a temporary SSH key pair
echo "── Starting SOCKS proxy on localhost:$LOCAL_PORT ──"
TEMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'ci-browse')
TEMP_KEY="$TEMP_DIR/ci-browse-key"
ssh-keygen -t ed25519 -f "$TEMP_KEY" -N "" -q || {
  echo "Error: Failed to generate temporary SSH key."
  exit 1
}

if [[ ! -f "${TEMP_KEY}.pub" ]]; then
  echo "Error: SSH key was not created at ${TEMP_KEY}.pub"
  echo "  Temp directory: $TEMP_DIR"
  ls -la "$TEMP_DIR" 2>/dev/null || echo "  (directory listing failed)"
  exit 1
fi

# Push the public key to the instance via EC2 Instance Connect (valid for 60s)
echo "  Pushing temporary SSH key to instance..."
aws ec2-instance-connect send-ssh-public-key \
  --instance-id "$INSTANCE_ID" \
  --instance-os-user ec2-user \
  --ssh-public-key "file://${TEMP_KEY}.pub" \
  $PROFILE_FLAG > /dev/null || {
  echo "Error: Failed to push SSH key via EC2 Instance Connect."
  exit 1
}

# Start SSH SOCKS proxy via SSM transport in the background
# Use -f to background after auth, but first verify it comes up
echo "  Connecting via SSM (this may take a few seconds)..."
ssh -D "$LOCAL_PORT" -N \
  -i "$TEMP_KEY" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o LogLevel=ERROR \
  -o ConnectTimeout=30 \
  -o "ProxyCommand=aws ssm start-session --target $INSTANCE_ID --document-name AWS-StartSSHSession --parameters portNumber=%p $PROFILE_FLAG" \
  ec2-user@"$INSTANCE_ID" &
SSH_PID=$!

# Wait for the proxy to start listening
echo "  Waiting for proxy to be ready..."
for i in $(seq 1 30); do
  if lsof -ti :"$LOCAL_PORT" &>/dev/null; then
    break
  fi
  if ! kill -0 "$SSH_PID" 2>/dev/null; then
    echo "Error: SSH process exited unexpectedly."
    exit 1
  fi
  sleep 1
done

if ! lsof -ti :"$LOCAL_PORT" &>/dev/null; then
  echo "Error: Proxy did not start within 30 seconds."
  kill "$SSH_PID" 2>/dev/null || true
  exit 1
fi

echo "  ✓ Proxy running (pid $SSH_PID)"

# Open Chrome with the proxy, pointed at the website
echo "── Opening Chrome ──"
CHROME_APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [[ -x "$CHROME_APP" ]]; then
  "$CHROME_APP" \
    --proxy-server="socks5://localhost:$LOCAL_PORT" \
    --user-data-dir="/tmp/chrome-ci-proxy" \
    "$WEBSITE_URL" &>/dev/null &
  echo "  ✓ Chrome opened to $WEBSITE_URL"
else
  echo "  Chrome not found at default path. Open your browser manually with:"
  echo "    Proxy: socks5://localhost:$LOCAL_PORT"
  echo "    URL:   $WEBSITE_URL"
fi

echo ""
echo "✓ Browsing session ready"
echo ""
echo "  Website: $WEBSITE_URL"
echo "  Proxy:   socks5://localhost:$LOCAL_PORT"
echo ""
echo "To stop the proxy: kill $SSH_PID"
