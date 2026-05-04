/** A resource type pair derived from splitting a CloudFormation resource type string. */
export interface ResourceTypePair {
  serviceName: string;
  resourceTypeName: string;
}

/** A property value match from a CloudFormation stack template. */
export interface PropertyMatch {
  serviceName: string;
  resourceTypeName: string;
  propertyName: string;
  value: string;
}

/** Response from GET /stacks/{stackName}/resources. */
export interface StackResourcesResponse {
  resourceTypePairs: ResourceTypePair[];
  propertyMatches: PropertyMatch[];
  warning?: string;
}

/** Response from GET /stacks. */
export interface ListStacksResponse {
  stacks: string[];
}
