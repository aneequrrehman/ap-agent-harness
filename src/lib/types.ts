// Shared domain types for the AP harness.

export type Decision = "approve" | "reject" | "route";

export type Route =
  | "procurement"
  | "logistics"
  | "ap_manager"
  | "ap_clerk"
  | "hold_for_receipt"
  | "fraud_review";

export interface Vendor {
  vendorId: string;
  name: string;
  tier: 1 | 2 | 3;
  category: string;
  paymentTerms: string;
  currency: "USD" | "EUR";
  bankAccount: { iban: string; changedAt: string };
  /** Informal notes a human AP clerk might know. Hidden from the agent on purpose. */
  hiddenQuirk?: string;
}

export interface POLine {
  lineNo: number;
  sku: string;
  description: string;
  qty: number;
  unitPrice: number;
  unit?: string;
}

export interface PurchaseOrder {
  poNumber: string;
  vendorId: string;
  lines: POLine[];
  total: number;
  currency: "USD" | "EUR";
  status: "open" | "closed";
  rush?: boolean;
  createdAt: string;
}

export interface Receipt {
  receiptId: string;
  poNumber: string;
  lines: { lineNo: number; qtyReceived: number }[];
  receivedAt: string;
}

export interface InvoiceLine {
  description: string;
  qty: number;
  unitPrice: number;
  sku?: string;
  unit?: string;
}

export interface InvoiceLabel {
  decision: Decision;
  route?: Route;
  reason: string;
  quirkId?: string;
}

export interface Invoice {
  invoiceId: string;
  invoiceNumber: string;
  vendorId: string;
  poNumber?: string;
  memo?: string;
  lines: InvoiceLine[];
  total: number;
  currency: "USD" | "EUR";
  invoiceDate: string;
  bankAccount: string;
  split: "train" | "eval";
  status?: "pending" | "paid" | "credited";
  label: InvoiceLabel;
}

// ---------- Harness ----------

export interface Rule {
  id: string;
  text: string;
  /** Null means global; otherwise applies to a vendorId. */
  scope: string | null;
  source: "seed" | "reflector";
  createdInVersion: number;
}

/** Structured condition evaluated in code against derived invoice facts. All set fields must match. */
export interface Condition {
  vendorId?: string;
  vendorTier?: 1 | 2 | 3;
  hasPO?: boolean;
  poFound?: boolean;
  hasReceipt?: boolean;
  memoMatches?: string; // regex, case-insensitive
  invoiceNumberMatches?: string; // regex
  bankMismatch?: boolean;
  bankChangedWithinDays?: number;
  totalOver?: number;
  currencyMismatch?: boolean;
  likelyDuplicate?: boolean;
}

export interface Action {
  decision: Decision;
  route?: Route;
  reason: string;
}

export interface Guardrail {
  id: string;
  text: string;
  /**
   * Hard guardrails carry a structured condition and are enforced in code after the model decides:
   * if the condition matches and the model said approve, the action overrides it.
   * Soft guardrails are prompt-only.
   */
  hard: boolean;
  when?: Condition;
  action?: Action;
  source: "seed" | "reflector";
  createdInVersion: number;
}

/** A deterministic pre-check the harness promotes from a learned pattern. Runs before the model, saving a call. */
export interface FastPath {
  id: string;
  name: string;
  when: Condition;
  action: Action;
  source: "reflector";
  createdInVersion: number;
  hits: number;
}

/** Facts derived in code for every invoice, used by conditions and shown to the model. */
export interface InvoiceFacts {
  vendorId: string;
  vendorTier: 1 | 2 | 3;
  hasPO: boolean;
  poFound: boolean;
  hasReceipt: boolean;
  bankMismatch: boolean;
  bankChangedDaysAgo: number;
  total: number;
  currencyMismatch: boolean;
  likelyDuplicate: boolean;
}

export interface ContextPolicy {
  /** How many of this vendor's past episodes to include in the prompt. */
  vendorHistoryLimit: number;
  /** Whether to include similar past exceptions from other vendors. */
  includeSimilarExceptions: boolean;
  /** Max number of rules to inline. Vendor-scoped rules are always included. */
  maxGlobalRules: number;
}

export interface ToolConfig {
  enabled: string[];
  /** Per-vendor price variance tolerance in percent. */
  priceTolerancePct: Record<string, number>;
  defaultPriceTolerancePct: number;
}

export interface HarnessVersion {
  version: number;
  parentVersion: number | null;
  createdAt: string;
  createdBy: "seed" | "reflector";
  status: "active" | "candidate" | "rejected" | "superseded";
  rules: Rule[];
  guardrails: Guardrail[];
  fastPaths: FastPath[];
  contextPolicy: ContextPolicy;
  tools: ToolConfig;
  changelog: string;
  rationale?: string;
  evalScore?: EvalScore;
  /** Training episodes whose failures triggered this candidate. */
  triggerEpisodeIds?: string[];
}

export interface EvalScore {
  accuracy: number; // 0..1 decision+route correct
  straightThrough: number; // 0..1 fraction auto-approved correctly without routing
  falseApprovals: number; // count
  total: number;
  modelCalls: number;
  fastPathHits: number;
  /** Planted quirk ids where every eval invoice was handled correctly. */
  quirksSolved: string[];
  quirksTotal: number;
}

export interface TraceStep {
  tool: string;
  input: unknown;
  output: unknown;
}

export interface Episode {
  episodeId: string;
  invoiceId: string;
  vendorId: string;
  version: number;
  phase: "train" | "eval" | "demo";
  decision: Decision;
  route?: Route;
  reason: string;
  expected: InvoiceLabel;
  correct: boolean;
  falseApproval: boolean;
  viaFastPath?: string;
  guardrailOverride?: string;
  trace: TraceStep[];
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  createdAt: string;
  /** Natural-language summary of the case and its human outcome, embedded for vector search. */
  summary?: string;
  embedding?: number[];
}
