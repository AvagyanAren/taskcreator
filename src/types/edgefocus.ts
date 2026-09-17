/**
 * Types derived directly from docs.json (Swagger 2.0, basePath /api/v1).
 * Only the fields this tool actually reads or writes are modelled.
 */

/** #/definitions/user.User */
export interface EFUser {
  id: number;
  username: string;
  name?: string;
  email?: string;
  created?: string;
  updated?: string;
}

/** #/definitions/models.Bucket */
export interface EFBucket {
  id: number;
  title: string;
  project_view_id?: number;
  position?: number;
  limit?: number;
  count?: number;
  created?: string;
  updated?: string;
}

/** #/definitions/models.Task (subset) */
export interface EFTask {
  id: number;
  title: string;
  description?: string;
  done?: boolean;
  project_id: number;
  /** RFC3339 timestamp, "When this task ends." */
  end_date?: string;
  /** RFC3339 timestamp, "The time when the task is due." */
  due_date?: string;
  start_date?: string;
  /** "The estimated time to complete this task, in minutes." */
  time_estimate?: number;
  /** Populated only when the task is accessed through a view with buckets. */
  bucket_id?: number;
  /** Per docs.json this is []models.Bucket, present only with expand=buckets. */
  buckets?: EFBucket[];
  assignees?: EFUser[];
  identifier?: string;
  index?: number;
  position?: number;
  created?: string;
  updated?: string;
}

/** #/definitions/models.ProjectView (subset) */
export interface EFProjectView {
  id: number;
  title: string;
  project_id: number;
  view_kind?: string;
  /** "If tasks are moved to the done bucket, they are marked as done." */
  done_bucket_id?: number;
  default_bucket_id?: number;
}

/** #/definitions/models.TaskBucket */
export interface EFTaskBucket {
  task_id: number;
  bucket_id: number;
  project_view_id: number;
  bucket?: EFBucket;
  task?: EFTask;
}

/** #/definitions/models.TaskAssginee (sic — spelling comes from the API docs) */
export interface EFTaskAssginee {
  user_id: number;
  created?: string;
}

/** Body accepted by PUT /projects/{id}/tasks */
export interface EFCreateTaskPayload {
  title: string;
  project_id: number;
  description?: string;
  end_date?: string;
  time_estimate?: number;
}

/** Parser output */
export interface ParsedTask {
  title: string;
  /** ISO calendar day, e.g. "2026-09-25" */
  dueDate: string | null;
  estimateMinutes: number | null;
  assignee: string | null;
  /** Kanban column title. Falls back to EDGEFOCUS_TARGET_BUCKET when null. */
  bucket?: string | null;
  /** Plain-text description; converted to HTML before it reaches the API. */
  description?: string | null;
}

export interface VerificationCheck {
  field: string;
  expected: string;
  actual: string;
  ok: boolean;
}

export interface CreatedTaskResult {
  taskId: number;
  title: string;
  dueDate: string | null;
  estimateMinutes: number | null;
  bucket: string | null;
  assignees: string[];
  url: string;
  verification: VerificationCheck[];
  verified: boolean;
}

export interface MovedTaskResult {
  taskId: number;
  title: string;
  bucket: string;
  done: boolean;
  url: string;
  verification: VerificationCheck[];
  verified: boolean;
}

export interface HistoryEntry extends CreatedTaskResult {
  createdAt: string;
}
