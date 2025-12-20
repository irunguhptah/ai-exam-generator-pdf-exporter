import { sqliteTable, AnySQLiteColumn, foreignKey, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const account = sqliteTable("account", {
	id: text().primaryKey().notNull(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" } ),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: integer("access_token_expires_at"),
	refreshTokenExpiresAt: integer("refresh_token_expires_at"),
	scope: text(),
	password: text(),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

export const exams = sqliteTable("exams", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	userId: text("user_id").notNull(),
	title: text().notNull(),
	subject: text().notNull(),
	difficulty: text().notNull(),
	numQuestions: integer("num_questions").notNull(),
	createdAt: text("created_at").notNull(),
	questionLength: text("question_length").default("medium").notNull(),
	coreTestingAreas: text("core_testing_areas").default("").notNull(),
	scenarioFormat: text("scenario_format").default("mixed").notNull(),
	// PDF metadata fields - generated once and cached
	subtitle: text(),
	examOverview: text("exam_overview"),
	examFeatures: text("exam_features"), // JSON string of features array
	coreTestingAreasFormatted: text("core_testing_areas_formatted"), // Formatted for PDF display
	domainsMetadata: text("domains_metadata"), // JSON string of domain distribution
});

export const questions = sqliteTable("questions", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	examId: integer("exam_id").notNull().references(() => exams.id),
	questionText: text("question_text").notNull(),
	questionType: text("question_type").notNull(),
	correctAnswer: text("correct_answer").notNull(),
	optionA: text("option_a"),
	optionB: text("option_b"),
	optionC: text("option_c"),
	optionD: text("option_d"),
	points: integer().default(1).notNull(),
	orderIndex: integer("order_index").notNull(),
	rationale: text(),
});

export const session = sqliteTable("session", {
	id: text().primaryKey().notNull(),
	expiresAt: integer("expires_at").notNull(),
	token: text().notNull(),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" } ),
},
(table) => [
	uniqueIndex("session_token_unique").on(table.token),
]);

export const user = sqliteTable("user", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	emailVerified: integer("email_verified").notNull(),
	image: text(),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
},
(table) => [
	uniqueIndex("user_email_unique").on(table.email),
]);

export const verification = sqliteTable("verification", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: integer("expires_at").notNull(),
	createdAt: integer("created_at"),
	updatedAt: integer("updated_at"),
});

