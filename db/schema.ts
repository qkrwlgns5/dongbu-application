import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const schools = sqliteTable(
  "schools",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordIterations: integer("password_iterations").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("schools_name_uq").on(table.name),
    uniqueIndex("schools_display_order_uq").on(table.displayOrder),
  ],
);

export const tournaments = sqliteTable(
  "tournaments",
  {
    id: text("id").primaryKey(),
    academicYear: integer("academic_year").notNull(),
    name: text("name").notNull(),
    surveyStart: text("survey_start").notNull(),
    surveyEnd: text("survey_end").notNull(),
    status: text("status", { enum: ["draft", "active", "archived"] }).notNull().default("draft"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("tournaments_year_idx").on(table.academicYear)],
);

export const appConfig = sqliteTable("app_config", {
  id: integer("id").primaryKey(),
  activeTournamentId: text("active_tournament_id").references(() => tournaments.id, { onDelete: "set null" }),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const adminCredentials = sqliteTable("admin_credentials", {
  id: integer("id").primaryKey(),
  username: text("username").notNull(),
  passwordAlgorithm: text("password_algorithm").notNull().default("pbkdf2-sha256-admin-v1"),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  authVersion: integer("auth_version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sports = sqliteTable(
  "sports",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    teamCountEnabled: integer("team_count_enabled", { mode: "boolean" }).notNull().default(false),
    maxTeamsPerSchool: integer("max_teams_per_school").notNull().default(2),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("sports_tournament_name_uq").on(table.tournamentId, table.name),
    index("sports_tournament_order_idx").on(table.tournamentId, table.displayOrder),
  ],
);

export const divisions = sqliteTable(
  "divisions",
  {
    id: text("id").primaryKey(),
    sportId: text("sport_id").notNull().references(() => sports.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    uniqueIndex("divisions_sport_name_uq").on(table.sportId, table.name),
    index("divisions_sport_order_idx").on(table.sportId, table.displayOrder),
  ],
);

export const responses = sqliteTable(
  "responses",
  {
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    schoolId: text("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
    noParticipation: integer("no_participation", { mode: "boolean" }).notNull().default(false),
    revision: integer("revision").notNull().default(1),
    firstSubmittedAt: text("first_submitted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.tournamentId, table.schoolId] }),
    index("responses_tournament_updated_idx").on(table.tournamentId, table.updatedAt),
  ],
);

export const responseItems = sqliteTable(
  "response_items",
  {
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    schoolId: text("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
    divisionId: text("division_id").notNull().references(() => divisions.id),
    teamCount: integer("team_count").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.tournamentId, table.schoolId, table.divisionId] }),
    index("response_items_division_idx").on(table.tournamentId, table.divisionId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    actorType: text("actor_type", { enum: ["school", "admin"] }).notNull(),
    schoolId: text("school_id").references(() => schools.id, { onDelete: "cascade" }),
    tournamentId: text("tournament_id").references(() => tournaments.id, { onDelete: "cascade" }),
    adminAuthVersion: integer("admin_auth_version"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("sessions_actor_idx").on(table.actorType, table.schoolId),
    index("sessions_expires_idx").on(table.expiresAt),
  ],
);

export const loginAttempts = sqliteTable("login_attempts", {
  attemptKey: text("attempt_key").primaryKey(),
  failureCount: integer("failure_count").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
  lockedUntil: text("locked_until"),
});

export const adminAuditLogs = sqliteTable(
  "admin_audit_logs",
  {
    id: text("id").primaryKey(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    detail: text("detail").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("admin_audit_created_idx").on(table.createdAt)],
);
