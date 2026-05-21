export type AiEngine = "auto" | "cursor" | "claudeCode";

export type BugPriority = "high" | "medium" | "low" | "unknown";

export type BugStatus = "active" | "resolved" | "closed" | "unknown";

export type FixStatus = "waiting" | "fixing" | "success" | "failed";

export type BugAssigneeScope = "mine" | "all" | "team" | "member";

export type BugWorkflowAction = "activate" | "confirm" | "resolve" | "close" | "assign";

export type BugResolveSolution =
  | "fixed"
  | "duplicate"
  | "external"
  | "willNotFix"
  | "notReproducible"
  | "postponed"
  | "byDesign";

export interface ZenTaoSession {
  account: string;
  cookie: string;
  createdAt: string;
}

export interface ZenTaoBugSummary {
  id: string;
  title: string;
  priority: BugPriority;
  status: BugStatus;
  createdAt?: string;
  assignedTo?: string;
  openedBy?: string;
  confirmed?: boolean;
}

export interface ZenTaoProject {
  id: string;
  name: string;
}

export interface ZenTaoMember {
  account: string;
  name: string;
}

export interface BugListQuery {
  projectId?: string;
  assigneeScope?: BugAssigneeScope;
  assignee?: string;
  teamMembers?: string[];
}

export interface BugWorkflowRequest {
  bugId: string;
  action: BugWorkflowAction;
  comment?: string;
  assignedTo?: string;
  solution?: BugResolveSolution;
  resolvedBuild?: string;
}

export interface ZenTaoBugDetail extends ZenTaoBugSummary {
  description?: string;
  descriptionHtml?: string;
  reproduceSteps?: string;
  reproduceStepsHtml?: string;
  expectedResult?: string;
  expectedResultHtml?: string;
  actualResult?: string;
  attachments: ZenTaoAttachment[];
  comments: ZenTaoComment[];
}

export interface ZenTaoAttachment {
  name: string;
  url?: string;
}

export interface ZenTaoComment {
  author?: string;
  createdAt?: string;
  content: string;
}

export interface FixRecord {
  bugId: string;
  aiEngine: AiEngine;
  status: FixStatus;
  fixedAt: string;
  message?: string;
}

export interface ZenTaoClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  session?: ZenTaoSession;
}

export interface LoginCredentials {
  account: string;
  password: string;
}
