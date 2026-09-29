import { z } from 'zod';

const explicitTargetSchema = z.strictObject({
  kind: z.literal('explicit-tabs'),
  tabIds: z.array(z.number().int()),
});

export const remoteRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('prepare'),
    baseURL: z.url(),
    fixtureUrl: z.url(),
    code: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('state') }),
  z.strictObject({ kind: z.literal('approve'), requestId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('echo'), value: z.string() }),
  z.strictObject({ kind: z.literal('attachment-ownership') }),
  z.strictObject({ kind: z.literal('stop-provider') }),
  z.strictObject({ kind: z.literal('dispose-client') }),
  z.strictObject({ kind: z.literal('close-peer') }),
]);
export type RemoteRequest = z.infer<typeof remoteRequestSchema>;

const approvalSchema = z.strictObject({
  requestId: z.string(),
  selector: explicitTargetSchema,
  accepted: z.boolean(),
  senderURL: z.string().nullable(),
});
export type ApprovalReceipt = z.infer<typeof approvalSchema>;

export const remoteStateSchema = z.strictObject({
  status: z.string().nullable(),
  isTrusted: z.boolean().nullable(),
  isolated: z.boolean().nullable(),
  targetTabId: z.number().int().nullable(),
  providerDisposed: z.boolean(),
  clientDisposed: z.boolean(),
  closed: z.boolean(),
  approvals: z.array(approvalSchema),
  errors: z.array(z.string()),
});
export type RemoteState = z.infer<typeof remoteStateSchema>;

export const remoteFailureResponseSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({ message: z.string() }),
});

function responseSchema<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    remoteFailureResponseSchema,
  ]);
}

export const prepareReceiptSchema = z.strictObject({
  unauthenticatedRejected: z.boolean(),
  unauthenticatedReason: z.enum(['native-unauthorized', 'unexpected-native-error']).nullable(),
  trustedBeforeCode: z.boolean().nullable(),
  invalidCodeAccepted: z.boolean(),
  validCodeAccepted: z.boolean(),
  currentTrusted: z.boolean().nullable(),
  echo: z.string(),
  state: remoteStateSchema,
});
export type PrepareReceipt = z.infer<typeof prepareReceiptSchema>;
export const prepareResponseSchema = responseSchema(prepareReceiptSchema);
export const stateResponseSchema = responseSchema(remoteStateSchema);
export const approveResponseSchema = responseSchema(remoteStateSchema);
export const echoResponseSchema = responseSchema(z.string());
export const attachmentOwnershipReceiptSchema = z.strictObject({
  ownsAttachment: z.boolean(),
  error: z.enum(['native-not-attached', 'unexpected-native-error']).nullable(),
});
export type AttachmentOwnershipReceipt = z.infer<typeof attachmentOwnershipReceiptSchema>;
export const attachmentOwnershipResponseSchema = responseSchema(attachmentOwnershipReceiptSchema);
export const stopProviderResponseSchema = responseSchema(remoteStateSchema);
export const disposeClientResponseSchema = responseSchema(
  z.strictObject({ state: remoteStateSchema, echo: z.string() }),
);
export const closePeerResponseSchema = responseSchema(remoteStateSchema);
