import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Shared DynamoDB Document Client singleton.
 * Reused across all store modules to avoid creating multiple connections.
 */
const dynamoClient = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Builds a DynamoDB SET UpdateExpression from a fields object.
 * Skips undefined values. Returns null if no fields to update.
 *
 * Usage:
 *   const expr = buildUpdateExpression({ name: 'new', updatedAt: '...' });
 *   if (!expr) throw new Error('No fields to update');
 *   await docClient.send(new UpdateCommand({ ...expr, TableName, Key }));
 */
export function buildUpdateExpression(fields: Record<string, unknown>): {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
} | null {
  const expressionParts: string[] = [];
  const expressionValues: Record<string, unknown> = {};
  const expressionNames: Record<string, string> = {};

  let index = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const attrAlias = `#attr${index}`;
    const valAlias = `:val${index}`;
    expressionParts.push(`${attrAlias} = ${valAlias}`);
    expressionNames[attrAlias] = key;
    expressionValues[valAlias] = value;
    index++;
  }

  if (expressionParts.length === 0) return null;

  return {
    UpdateExpression: `SET ${expressionParts.join(', ')}`,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: expressionValues,
  };
}
