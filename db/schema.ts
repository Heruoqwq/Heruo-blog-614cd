import { sqliteTable, text, integer, index, check, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  disabled: integer("disabled").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, () => [check("users_role", sql.raw("(id=1 AND role='superadmin') OR (id>1 AND role='user')"))]);
export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  excerpt: text("excerpt").notNull().default(""),
  category: text("category").notNull().default("随笔"),
  tags: text("tags").notNull().default("[]"),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  authorId: integer("author_id").references(() => users.id),
  featured: integer("featured").notNull().default(0),
}, (t) => [index("posts_status_date").on(t.status, t.createdAt), index("posts_author_date").on(t.authorId, t.createdAt)]);
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  done: integer("done").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  userId: integer("user_id").references(() => users.id),
}, (t) => [index("tasks_user_date").on(t.userId, t.createdAt)]);
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
  userId: integer("user_id").references(() => users.id),
}, (t) => [index("sessions_user").on(t.userId)]);
export const loginLimits = sqliteTable("login_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  attempts: integer("attempts").notNull(),
});
export const ojProblems = sqliteTable("oj_problems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  statement: text("statement").notNull(),
  editorial: text("editorial").notNull().default(""),
  editorialPublished: integer("editorial_published").notNull().default(0),
  difficulty: integer("difficulty").notNull().default(0),
  difficultyTier: integer("difficulty_tier").notNull().default(0),
  quality: integer("quality").notNull().default(0),
  qualityNote: text("quality_note").notNull().default(""),
  samples: text("samples").notNull().default("[]"),
  timeLimit: integer("time_limit").notNull().default(1000),
  memoryLimit: integer("memory_limit").notNull().default(256),
  published: integer("published").notNull().default(0),
  checker: text("checker").notNull().default("text"),
  scoring: text("scoring").notNull().default("weighted"),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  teamId: text("team_id").references((): any => teams.id, { onDelete: "cascade" }),
});
export const ojFiles = sqliteTable("oj_files", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  createdAt: text("created_at").notNull(),
  teamId: text("team_id").references((): any => teams.id, { onDelete: "cascade" }),
});
export const ojCases = sqliteTable("oj_cases", {
  id: text("id").primaryKey(),
  problemId: integer("problem_id").notNull().references(() => ojProblems.id),
  position: integer("position").notNull(),
  input: text("input").notNull(),
  output: text("output").notNull(),
  groupId: integer("group_id").notNull().default(1),
  weight: integer("weight").notNull().default(1),
  inputFile: text("input_file").references(() => ojFiles.id),
  outputFile: text("output_file").references(() => ojFiles.id),
}, (t) => [index("oj_cases_problem").on(t.problemId, t.position)]);
export const ojSubmissions = sqliteTable("oj_submissions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  problemId: integer("problem_id").notNull().references(() => ojProblems.id),
  problemCode: text("problem_code").notNull(),
  problemTitle: text("problem_title").notNull(),
  source: text("source").notNull(),
  checker: text("checker").notNull().default("text"),
  scoring: text("scoring").notNull().default("weighted"),
  expectedOutputs: text("expected_outputs").notNull().default("[]"),
  revision: integer("revision").notNull(),
  status: text("status").notNull().default("QUEUED"),
  score: integer("score").notNull().default(0),
  passed: integer("passed").notNull().default(0),
  total: integer("total").notNull(),
  time: integer("time").notNull().default(0),
  memory: integer("memory").notNull().default(0),
  details: text("details").notNull().default("[]"),
  compileLog: text("compile_log").notNull().default(""),
  judgeTokens: text("judge_tokens").notNull().default("[]"),
  judgeError: text("judge_error").notNull().default(""),
  judgeAttempts: integer("judge_attempts").notNull().default(0),
  judgeStartedAt: integer("judge_started_at").notNull().default(0),
  judgeUrl: text("judge_url").notNull(),
  timeLimit: integer("time_limit").notNull(),
  memoryLimit: integer("memory_limit").notNull(),
  leaseUntil: integer("lease_until").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("oj_submissions_user").on(t.userId, t.createdAt), index("oj_submissions_problem").on(t.problemId, t.createdAt)]);
export const userPermissions = sqliteTable("user_permissions", {
  userId: integer("user_id").notNull().references(() => users.id),
  permission: text("permission").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.permission] }), check("permission_name", sql.raw("permission IN ('users','posts','solutions','problems','discussions')"))]);
export const sanctions = sqliteTable("sanctions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  actorId: integer("actor_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  reason: text("reason").notNull(),
  expiresAt: integer("expires_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull(),
}, (t) => [index("sanctions_user").on(t.userId, t.kind, t.expiresAt), check("sanction_kind", sql.raw("kind IN ('mute','ban')"))]);
export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  ownerId: integer("owner_id").notNull().references(() => users.id),
  visibility: text("visibility").notNull().default("public"),
  joinPolicy: text("join_policy").notNull().default("approval"),
  joinClosed: integer("join_closed").notNull().default(0),
  joinCode: text("join_code").notNull(),
  archived: integer("archived").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, () => [check("team_visibility", sql.raw("visibility IN ('public','private')")), check("team_join_policy", sql.raw("join_policy IN ('open','approval')"))]);
export const teamMembers = sqliteTable("team_members", {
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("pending"),
  joinedAt: text("joined_at").notNull(),
}, (t) => [primaryKey({ columns: [t.teamId, t.userId] }), index("team_members_user").on(t.userId, t.teamId), check("team_member_role", sql.raw("role IN ('owner','admin','member')")), check("team_member_status", sql.raw("status IN ('active','pending')"))]);
export const teamProblems = sqliteTable("team_problems", {
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  problemId: integer("problem_id").notNull().references(() => ojProblems.id),
  addedAt: text("added_at").notNull(),
}, (t) => [primaryKey({ columns: [t.teamId, t.problemId] })]);
export const discussions = sqliteTable("discussions", {
  id: text("id").primaryKey(),
  authorId: integer("author_id").notNull().references(() => users.id),
  problemId: integer("problem_id").references(() => ojProblems.id),
  teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").notNull().default("交流"),
  pinned: integer("pinned").notNull().default(0),
  locked: integer("locked").notNull().default(0),
  hidden: integer("hidden").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("discussions_feed").on(t.teamId, t.hidden, t.pinned, t.createdAt), index("discussions_problem").on(t.problemId)]);
export const discussionReplies = sqliteTable("discussion_replies", {
  id: text("id").primaryKey(),
  discussionId: text("discussion_id").notNull().references(() => discussions.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [index("discussion_replies_thread").on(t.discussionId, t.createdAt)]);
export const solutions = sqliteTable("solutions", {
  id: text("id").primaryKey(),
  problemId: integer("problem_id").notNull().references(() => ojProblems.id),
  authorId: integer("author_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("draft"),
  featured: integer("featured").notNull().default(0),
  reviewNote: text("review_note").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("solutions_feed").on(t.problemId, t.status, t.createdAt), index("solutions_author").on(t.authorId), check("solution_status", sql.raw("status IN ('draft','pending','published','rejected')"))]);
export const solutionLikes = sqliteTable("solution_likes", {
  solutionId: text("solution_id").notNull().references(() => solutions.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
}, (t) => [primaryKey({ columns: [t.solutionId, t.userId] })]);
export const solutionComments = sqliteTable("solution_comments", {
  id: text("id").primaryKey(),
  solutionId: text("solution_id").notNull().references(() => solutions.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [index("solution_comments_thread").on(t.solutionId, t.createdAt)]);
