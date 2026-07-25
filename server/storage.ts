// Database integration blueprint reference: javascript_database
// Replit Auth integration blueprint reference: javascript_log_in_with_replit
import {
  users, courses, lessons, liveSessions, transcripts, quizzes, quizAttempts,
  chatMessages, chatSessions, memoryEntries, purchases, analyticsEvents,
  fileUploads, studentProfiles, schools, studyPlans, userProgress,
  codeSnippets, examResults, generatedWebsites, learningHistory,
  generatedImages, topicExplanations, notifications, voiceConversations,
  documentUploads, liveAiFeatures, cbtExams, cbtQuestions, cbtSessions,
  cbtAnswers, cbtExamHistory, cbtAnalytics, cbtQuestionLicensing,
  recordings, generatedLessons,
  type User, type UpsertUser, type Course, type InsertCourse,
  type Lesson, type InsertLesson, type LiveSession, type InsertLiveSession,
  type Transcript, type InsertTranscript, type Quiz, type InsertQuiz,
  type QuizAttempt, type InsertQuizAttempt, type ChatMessage, type InsertChatMessage,
  type ChatSession, type InsertChatSession, type MemoryEntry, type InsertMemoryEntry,
  type Purchase, type InsertPurchase, type AnalyticsEvent, type InsertAnalyticsEvent,
  type FileUpload, type InsertFileUpload, type StudentProfile, type InsertStudentProfile,
  type School, type InsertSchool, type StudyPlan, type InsertStudyPlan,
  type UserProgress, type InsertUserProgress, type CodeSnippet, type InsertCodeSnippet,
  type ExamResult, type InsertExamResult, type GeneratedWebsite, type InsertGeneratedWebsite,
  type LearningHistory, type InsertLearningHistory, type GeneratedImage, type InsertGeneratedImage,
  type TopicExplanation, type InsertTopicExplanation, type Notification, type InsertNotification,
  type VoiceConversation, type InsertVoiceConversation, type DocumentUpload, type InsertDocumentUpload,
  type LiveAiFeature, type InsertLiveAiFeature, type CbtExam, type InsertCbtExam,
  type CbtQuestion, type InsertCbtQuestion, type CbtSession, type InsertCbtSession,
  type CbtAnswer, type InsertCbtAnswer, type CbtExamHistory, type InsertCbtExamHistory,
  type CbtAnalytics, type InsertCbtAnalytics, type CbtQuestionLicensing, type InsertCbtQuestionLicensing,
  type Recording, type InsertRecording, type GeneratedLesson, type InsertGeneratedLesson,
} from "@shared/schema";
import { db, supabaseDb } from "./db";
import { eq, desc, and } from "drizzle-orm";
import { nanoid } from "nanoid";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, updates: any): Promise<User | undefined>;

  // Course operations
  getCourse(id: string): Promise<Course | undefined>;
  getCoursesByTeacher(teacherId: string): Promise<Course[]>;
  getAllCourses(): Promise<Course[]>;
  createCourse(course: InsertCourse): Promise<Course>;
  updateCourse(id: string, updates: Partial<InsertCourse>): Promise<Course | undefined>;

  // Lesson operations
  getLesson(id: string): Promise<Lesson | undefined>;
  getLessonsByCourse(courseId: string): Promise<Lesson[]>;
  createLesson(lesson: InsertLesson): Promise<Lesson>;

  // Live session operations
  getLiveSession(id: string): Promise<LiveSession | undefined>;
  getLiveSessionsByHost(hostId: string): Promise<LiveSession[]>;
  getLiveSessionsByTeacher(teacherId: string): Promise<LiveSession[]>;
  createLiveSession(session: InsertLiveSession): Promise<LiveSession>;
  updateLiveSession(id: string, updates: Partial<InsertLiveSession>): Promise<LiveSession | undefined>;

  // Transcript operations
  getTranscript(id: string): Promise<Transcript | undefined>;
  getTranscriptsBySession(sessionId: string): Promise<Transcript[]>;
  createTranscript(transcript: InsertTranscript): Promise<Transcript>;

  // Quiz operations
  getQuiz(id: string): Promise<Quiz | undefined>;
  getQuizzesByCourse(courseId: string): Promise<Quiz[]>;
  createQuiz(quiz: InsertQuiz): Promise<Quiz>;

  // Quiz attempt operations
  getQuizAttempt(id: string): Promise<QuizAttempt | undefined>;
  getQuizAttemptsByStudent(studentId: string): Promise<QuizAttempt[]>;
  createQuizAttempt(attempt: InsertQuizAttempt): Promise<QuizAttempt>;

  // Chat message operations
  getChatMessagesByUser(userId: string, limit?: number): Promise<ChatMessage[]>;
  getChatMessagesBySession(sessionId: string): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  deleteChatMessagesByUser(userId: string): Promise<void>;

  // Chat session operations
  getChatSession(id: string): Promise<ChatSession | undefined>;
  getChatSessionsByUser(userId: string): Promise<ChatSession[]>;
  createChatSession(session: InsertChatSession): Promise<ChatSession>;
  updateChatSession(id: string, updates: Partial<InsertChatSession>): Promise<ChatSession | undefined>;
  deleteChatSession(id: string): Promise<void>;

  // Memory entry operations
  getMemoryEntriesByUser(userId: string): Promise<MemoryEntry[]>;
  createMemoryEntry(entry: InsertMemoryEntry): Promise<MemoryEntry>;

  // Purchase operations
  getPurchase(id: string): Promise<Purchase | undefined>;
  getPurchasesByBuyer(buyerId: string): Promise<Purchase[]>;
  getPurchasesByUser(userId: string): Promise<Purchase[]>;
  createPurchase(purchase: InsertPurchase): Promise<Purchase>;
  updatePurchaseStatus(id: string, status: string): Promise<Purchase | undefined>;

  // Analytics operations
  createAnalyticsEvent(event: InsertAnalyticsEvent): Promise<AnalyticsEvent>;

  // File upload operations
  getFileUpload(id: string): Promise<FileUpload | undefined>;
  getFileUploadsByUser(userId: string): Promise<FileUpload[]>;
  createFileUpload(upload: InsertFileUpload): Promise<FileUpload>;
  updateFileUploadStatus(id: string, status: string, extractedText?: string): Promise<FileUpload | undefined>;
  deleteFileUpload(id: string): Promise<void>;

  // Study plan operations
  getStudyPlan(id: string): Promise<StudyPlan | undefined>;
  getStudyPlansByUser(userId: string): Promise<StudyPlan[]>;
  createStudyPlan(plan: InsertStudyPlan): Promise<StudyPlan>;
  updateStudyPlan(id: string, updates: Partial<InsertStudyPlan>): Promise<StudyPlan | undefined>;

  // User progress operations
  getUserProgress(userId: string, subject: string): Promise<UserProgress | undefined>;
  getUserProgressByUser(userId: string): Promise<UserProgress[]>;
  createUserProgress(progress: InsertUserProgress): Promise<UserProgress>;
  updateUserProgress(id: string, updates: Partial<InsertUserProgress>): Promise<UserProgress | undefined>;

  // Code snippet operations
  getCodeSnippet(id: string): Promise<CodeSnippet | undefined>;
  getCodeSnippetsByUser(userId: string): Promise<CodeSnippet[]>;
  createCodeSnippet(snippet: InsertCodeSnippet): Promise<CodeSnippet>;
  updateCodeSnippet(id: string, updates: Partial<InsertCodeSnippet>): Promise<CodeSnippet | undefined>;

  // Exam result operations
  getExamResult(id: string): Promise<ExamResult | undefined>;
  getExamResultsByUser(userId: string): Promise<ExamResult[]>;
  createExamResult(result: InsertExamResult): Promise<ExamResult>;

  // Generated website operations
  getGeneratedWebsite(id: string): Promise<GeneratedWebsite | undefined>;
  getGeneratedWebsitesByUser(userId: string): Promise<GeneratedWebsite[]>;
  createGeneratedWebsite(website: InsertGeneratedWebsite): Promise<GeneratedWebsite>;
  updateGeneratedWebsite(id: string, updates: Partial<InsertGeneratedWebsite>): Promise<GeneratedWebsite | undefined>;
  deleteGeneratedWebsite(id: string): Promise<void>;
  toggleFavoriteWebsite(id: string, isFavorite: boolean): Promise<GeneratedWebsite | undefined>;
  incrementViewCount(id: string): Promise<GeneratedWebsite | undefined>;

  // Learning history operations
  createLearningHistory(history: InsertLearningHistory): Promise<LearningHistory>;
  getLearningHistoryByUser(userId: string, limit?: number): Promise<LearningHistory[]>;
  getLearningHistoryBySubject(userId: string, subject: string): Promise<LearningHistory[]>;

  // Generated image operations
  createGeneratedImage(image: InsertGeneratedImage): Promise<GeneratedImage>;
  getGeneratedImagesByUser(userId: string): Promise<GeneratedImage[]>;
  getGeneratedImagesByTopic(userId: string, topic: string): Promise<GeneratedImage[]>;
  deleteGeneratedImage(userId: string, imageId: string): Promise<void>;

  // Topic explanation operations
  createTopicExplanation(explanation: InsertTopicExplanation): Promise<TopicExplanation>;
  getTopicExplanation(userId: string, subject: string, topic: string): Promise<TopicExplanation | undefined>;
  getTopicExplanationsByUser(userId: string): Promise<TopicExplanation[]>;

  // Notification operations
  createNotification(notification: InsertNotification): Promise<Notification>;
  getNotificationsByUser(userId: string, limit?: number): Promise<Notification[]>;
  getNotification(id: string): Promise<Notification | undefined>;
  markNotificationAsRead(id: string): Promise<Notification | undefined>;
  deleteNotification(id: string): Promise<void>;

  // LIVE AI operations
  createVoiceConversation(conversation: InsertVoiceConversation): Promise<VoiceConversation>;
  getVoiceConversationsByUser(userId: string): Promise<VoiceConversation[]>;
  createDocumentUpload(doc: InsertDocumentUpload): Promise<DocumentUpload>;
  updateDocumentUpload(id: string, updates: Partial<DocumentUpload>): Promise<DocumentUpload | undefined>;
  getDocumentUploadsByUser(userId: string): Promise<DocumentUpload[]>;
  createLiveAiFeature(feature: InsertLiveAiFeature): Promise<LiveAiFeature>;
  getLiveAiFeaturesByUser(userId: string): Promise<LiveAiFeature[]>;

  // Recording operations
  createRecording(recording: InsertRecording): Promise<Recording>;
  getRecordingsByUser(userId: string): Promise<Recording[]>;
  deleteRecording(id: string): Promise<void>;

  // Generated Lesson operations
  createGeneratedLesson(lesson: InsertGeneratedLesson): Promise<GeneratedLesson>;
  getGeneratedLessonsByUser(userId: string): Promise<GeneratedLesson[]>;
  deleteGeneratedLesson(id: string): Promise<void>;

  // Project Workspace operations
  getProjectsByUser(userId: string): Promise<any[]>;
  createProject(project: any): Promise<any>;
  updateProject(id: string, updates: any): Promise<any>;
  deleteProject(id: string): Promise<void>;
  getFilesByProject(projectId: string): Promise<any[]>;
  createFile(file: any): Promise<any>;
  deleteFile(id: string): Promise<void>;
  getTasksByProject(projectId: string): Promise<any[]>;
  createTask(task: any): Promise<any>;
  updateTask(id: string, updates: any): Promise<any>;
  deleteTask(id: string): Promise<void>;

  // CBT Exam operations
  createCbtExamHistory(exam: any): Promise<any>;
  getCbtExamHistoryByUser(userId: string): Promise<any[]>;
  deleteCbtExamHistory(id: string): Promise<void>;
  updateCbtAnalytics(userId: string, topic: string, isStrong: boolean): Promise<any>;
  getCbtAnalyticsByUser(userId: string): Promise<any>;
  createCbtQuestion(question: any): Promise<any>;
  createCbtQuestionLicensing(licensing: any): Promise<any>;
  getCbtQuestionLicensing(questionId: string): Promise<any>;

  // CBT Mode operations
  getCbtExam(id: string): Promise<CbtExam | undefined>;
  getAllCbtExams(): Promise<CbtExam[]>;
  createCbtExam(exam: InsertCbtExam): Promise<CbtExam>;
  getCbtQuestions(examId: string): Promise<CbtQuestion[]>;
  createCbtSession(session: InsertCbtSession): Promise<CbtSession>;
  getCbtSession(id: string): Promise<CbtSession | undefined>;
  getCbtSessionsByUser(userId: string): Promise<CbtSession[]>;
  updateCbtSession(id: string, updates: Partial<InsertCbtSession>): Promise<CbtSession | undefined>;
  createCbtAnswer(answer: InsertCbtAnswer): Promise<CbtAnswer>;
  getCbtAnswersBySession(sessionId: string): Promise<CbtAnswer[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db.insert(users).values(userData).onConflictDoUpdate({
      target: users.id,
      set: { ...userData, updatedAt: new Date() },
    }).returning();
    return user;
  }

  async updateUser(id: string, updates: any): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ ...updates, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return updated;
  }

  // Course operations
  async getCourse(id: string): Promise<Course | undefined> {
    const [course] = await db.select().from(courses).where(eq(courses.id, id));
    return course;
  }

  async getCoursesByTeacher(teacherId: string): Promise<Course[]> {
    return await db.select().from(courses).where(eq(courses.teacherId, teacherId));
  }

  async getAllCourses(): Promise<Course[]> {
    return await db.select().from(courses).where(eq(courses.isPublished, true));
  }

  async createCourse(course: InsertCourse): Promise<Course> {
    const [newCourse] = await db.insert(courses).values(course).returning();
    return newCourse;
  }

  async updateCourse(id: string, updates: Partial<InsertCourse>): Promise<Course | undefined> {
    const [updated] = await db.update(courses).set({ ...updates, updatedAt: new Date() }).where(eq(courses.id, id)).returning();
    return updated;
  }

  // Lesson operations
  async getLesson(id: string): Promise<Lesson | undefined> {
    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, id));
    return lesson;
  }

  async getLessonsByCourse(courseId: string): Promise<Lesson[]> {
    return await db.select().from(lessons).where(eq(lessons.courseId, courseId));
  }

  async createLesson(lesson: InsertLesson): Promise<Lesson> {
    const [newLesson] = await db.insert(lessons).values(lesson).returning();
    return newLesson;
  }

  // Live session operations
  async getLiveSession(id: string): Promise<LiveSession | undefined> {
    const [session] = await db.select().from(liveSessions).where(eq(liveSessions.id, id));
    return session;
  }

  async getLiveSessionsByHost(hostId: string): Promise<LiveSession[]> {
    return await db.select().from(liveSessions).where(eq(liveSessions.hostId, hostId)).orderBy(desc(liveSessions.startedAt));
  }

  async getLiveSessionsByTeacher(teacherId: string): Promise<LiveSession[]> {
    return await this.getLiveSessionsByHost(teacherId);
  }

  async createLiveSession(session: InsertLiveSession): Promise<LiveSession> {
    const [newSession] = await db.insert(liveSessions).values(session).returning();
    return newSession;
  }

  async updateLiveSession(id: string, updates: Partial<InsertLiveSession>): Promise<LiveSession | undefined> {
    const [updated] = await db.update(liveSessions).set(updates).where(eq(liveSessions.id, id)).returning();
    return updated;
  }

  // Transcript operations
  async getTranscript(id: string): Promise<Transcript | undefined> {
    const [transcript] = await db.select().from(transcripts).where(eq(transcripts.id, id));
    return transcript;
  }

  async getTranscriptsBySession(sessionId: string): Promise<Transcript[]> {
    return await db.select().from(transcripts).where(eq(transcripts.sessionId, sessionId));
  }

  async createTranscript(transcript: InsertTranscript): Promise<Transcript> {
    const [newTranscript] = await db.insert(transcripts).values(transcript).returning();
    return newTranscript;
  }

  // Quiz operations
  async getQuiz(id: string): Promise<Quiz | undefined> {
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, id));
    return quiz;
  }

  async getQuizzesByCourse(courseId: string): Promise<Quiz[]> {
    return await db.select().from(quizzes).where(eq(quizzes.courseId, courseId));
  }

  async createQuiz(quiz: InsertQuiz): Promise<Quiz> {
    const [newQuiz] = await db.insert(quizzes).values(quiz).returning();
    return newQuiz;
  }

  // Quiz attempt operations
  async getQuizAttempt(id: string): Promise<QuizAttempt | undefined> {
    const [attempt] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, id));
    return attempt;
  }

  async getQuizAttemptsByStudent(studentId: string): Promise<QuizAttempt[]> {
    return await db.select().from(quizAttempts).where(eq(quizAttempts.studentId, studentId));
  }

  async createQuizAttempt(attempt: InsertQuizAttempt): Promise<QuizAttempt> {
    const [newAttempt] = await db.insert(quizAttempts).values(attempt).returning();
    return newAttempt;
  }

  // Chat message operations
  async getChatMessagesByUser(userId: string, limit: number = 50): Promise<ChatMessage[]> {
    return await db.select().from(chatMessages).where(eq(chatMessages.userId, userId)).orderBy(chatMessages.createdAt).limit(limit);
  }

  async getChatMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
    return await db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId)).orderBy(chatMessages.createdAt);
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [newMessage] = await db.insert(chatMessages).values(message).returning();
    return newMessage;
  }

  async deleteChatMessagesByUser(userId: string): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
  }

  // Chat session operations
  async getChatSession(id: string): Promise<ChatSession | undefined> {
    const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, id));
    return session;
  }

  async getChatSessionsByUser(userId: string): Promise<ChatSession[]> {
    return await db.select().from(chatSessions).where(eq(chatSessions.userId, userId)).orderBy(desc(chatSessions.updatedAt));
  }

  async createChatSession(session: InsertChatSession): Promise<ChatSession> {
    const [newSession] = await db.insert(chatSessions).values(session).returning();
    return newSession;
  }

  async updateChatSession(id: string, updates: Partial<InsertChatSession>): Promise<ChatSession | undefined> {
    const [updated] = await db.update(chatSessions).set({ ...updates, updatedAt: new Date() }).where(eq(chatSessions.id, id)).returning();
    return updated;
  }

  async deleteChatSession(id: string): Promise<void> {
    await db.delete(chatSessions).where(eq(chatSessions.id, id));
  }

  // Memory entry operations
  async getMemoryEntriesByUser(userId: string): Promise<MemoryEntry[]> {
    return await db.select().from(memoryEntries).where(eq(memoryEntries.userId, userId)).orderBy(desc(memoryEntries.createdAt));
  }

  async createMemoryEntry(entry: InsertMemoryEntry): Promise<MemoryEntry> {
    const [newEntry] = await db.insert(memoryEntries).values(entry).returning();
    return newEntry;
  }

  // Purchase operations
  async getPurchase(id: string): Promise<Purchase | undefined> {
    const [purchase] = await db.select().from(purchases).where(eq(purchases.id, id));
    return purchase;
  }

  async getPurchasesByBuyer(buyerId: string): Promise<Purchase[]> {
    return await db.select().from(purchases).where(eq(purchases.buyerId, buyerId));
  }

  async getPurchasesByUser(userId: string): Promise<Purchase[]> {
    return await this.getPurchasesByBuyer(userId);
  }

  async createPurchase(purchase: InsertPurchase): Promise<Purchase> {
    const [newPurchase] = await db.insert(purchases).values(purchase).returning();
    return newPurchase;
  }

  async updatePurchaseStatus(id: string, status: string): Promise<Purchase | undefined> {
    const [updated] = await db.update(purchases).set({ paymentStatus: status as any }).where(eq(purchases.id, id)).returning();
    return updated;
  }

  // Analytics operations
  async createAnalyticsEvent(event: InsertAnalyticsEvent): Promise<AnalyticsEvent> {
    const [newEvent] = await db.insert(analyticsEvents).values(event).returning();
    return newEvent;
  }

  // File upload operations
  async getFileUpload(id: string): Promise<FileUpload | undefined> {
    const [upload] = await db.select().from(fileUploads).where(eq(fileUploads.id, id));
    return upload;
  }

  async getFileUploadsByUser(userId: string): Promise<FileUpload[]> {
    return await db.select().from(fileUploads).where(eq(fileUploads.userId, userId));
  }

  async createFileUpload(upload: InsertFileUpload): Promise<FileUpload> {
    const [newUpload] = await db.insert(fileUploads).values(upload).returning();
    return newUpload;
  }

  async updateFileUploadStatus(id: string, status: string, extractedText?: string): Promise<FileUpload | undefined> {
    const updateData: any = { processingStatus: status };
    if (extractedText) updateData.extractedText = extractedText;
    const [updated] = await db.update(fileUploads).set(updateData).where(eq(fileUploads.id, id)).returning();
    return updated;
  }

  async deleteFileUpload(id: string): Promise<void> {
    await db.delete(fileUploads).where(eq(fileUploads.id, id));
  }

  // Study plan operations
  async getStudyPlan(id: string): Promise<StudyPlan | undefined> {
    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, id));
    return plan;
  }

  async getStudyPlansByUser(userId: string): Promise<StudyPlan[]> {
    return await db.select().from(studyPlans).where(eq(studyPlans.userId, userId));
  }

  async createStudyPlan(plan: InsertStudyPlan): Promise<StudyPlan> {
    const [newPlan] = await db.insert(studyPlans).values(plan).returning();
    return newPlan;
  }

  async updateStudyPlan(id: string, updates: Partial<InsertStudyPlan>): Promise<StudyPlan | undefined> {
    const [updated] = await db.update(studyPlans).set({ ...updates, updatedAt: new Date() }).where(eq(studyPlans.id, id)).returning();
    return updated;
  }

  // User progress operations
  async getUserProgress(userId: string, subject: string): Promise<UserProgress | undefined> {
    const [progress] = await db.select().from(userProgress).where(and(eq(userProgress.userId, userId), eq(userProgress.subject, subject)));
    return progress;
  }

  async getUserProgressByUser(userId: string): Promise<UserProgress[]> {
    return await db.select().from(userProgress).where(eq(userProgress.userId, userId));
  }

  async createUserProgress(progress: InsertUserProgress): Promise<UserProgress> {
    const [newProgress] = await db.insert(userProgress).values(progress).returning();
    return newProgress;
  }

  async updateUserProgress(id: string, updates: Partial<InsertUserProgress>): Promise<UserProgress | undefined> {
    const [updated] = await db.update(userProgress).set({ ...updates, updatedAt: new Date() }).where(eq(userProgress.id, id)).returning();
    return updated;
  }

  // Code snippet operations
  async getCodeSnippet(id: string): Promise<CodeSnippet | undefined> {
    const [snippet] = await db.select().from(codeSnippets).where(eq(codeSnippets.id, id));
    return snippet;
  }

  async getCodeSnippetsByUser(userId: string): Promise<CodeSnippet[]> {
    return await db.select().from(codeSnippets).where(eq(codeSnippets.userId, userId));
  }

  async createCodeSnippet(snippet: InsertCodeSnippet): Promise<CodeSnippet> {
    const [newSnippet] = await db.insert(codeSnippets).values(snippet).returning();
    return newSnippet;
  }

  async updateCodeSnippet(id: string, updates: Partial<InsertCodeSnippet>): Promise<CodeSnippet | undefined> {
    const [updated] = await db.update(codeSnippets).set({ ...updates, updatedAt: new Date() }).where(eq(codeSnippets.id, id)).returning();
    return updated;
  }

  // Exam result operations
  async getExamResult(id: string): Promise<ExamResult | undefined> {
    const [result] = await db.select().from(examResults).where(eq(examResults.id, id));
    return result;
  }

  async getExamResultsByUser(userId: string): Promise<ExamResult[]> {
    return await db.select().from(examResults).where(eq(examResults.userId, userId)).orderBy(desc(examResults.createdAt));
  }

  async createExamResult(result: InsertExamResult): Promise<ExamResult> {
    const [newResult] = await db.insert(examResults).values(result).returning();
    return newResult;
  }

  // Generated website operations
  async getGeneratedWebsite(id: string): Promise<GeneratedWebsite | undefined> {
    const [website] = await db.select().from(generatedWebsites).where(eq(generatedWebsites.id, id));
    return website;
  }

  async getGeneratedWebsitesByUser(userId: string): Promise<GeneratedWebsite[]> {
    return await db.select().from(generatedWebsites).where(eq(generatedWebsites.userId, userId)).orderBy(desc(generatedWebsites.createdAt));
  }

  async createGeneratedWebsite(website: InsertGeneratedWebsite): Promise<GeneratedWebsite> {
    const [newWebsite] = await db.insert(generatedWebsites).values(website).returning();
    return newWebsite;
  }

  async updateGeneratedWebsite(id: string, updates: Partial<InsertGeneratedWebsite>): Promise<GeneratedWebsite | undefined> {
    const [updated] = await db.update(generatedWebsites).set({ ...updates, updatedAt: new Date() }).where(eq(generatedWebsites.id, id)).returning();
    return updated;
  }

  async deleteGeneratedWebsite(id: string): Promise<void> {
    await db.delete(generatedWebsites).where(eq(generatedWebsites.id, id));
  }

  async toggleFavoriteWebsite(id: string, isFavorite: boolean): Promise<GeneratedWebsite | undefined> {
    const [updated] = await db.update(generatedWebsites).set({ isFavorite, updatedAt: new Date() }).where(eq(generatedWebsites.id, id)).returning();
    return updated;
  }

  async incrementViewCount(id: string): Promise<GeneratedWebsite | undefined> {
    const website = await this.getGeneratedWebsite(id);
    if (!website) return undefined;
    const [updated] = await db.update(generatedWebsites).set({ viewCount: (website.viewCount || 0) + 1, updatedAt: new Date() }).where(eq(generatedWebsites.id, id)).returning();
    return updated;
  }

  // Learning history operations
  async createLearningHistory(history: InsertLearningHistory): Promise<LearningHistory> {
    const [newHistory] = await db.insert(learningHistory).values(history).returning();
    return newHistory;
  }

  async getLearningHistoryByUser(userId: string, limit?: number): Promise<LearningHistory[]> {
    const query = db.select().from(learningHistory).where(eq(learningHistory.userId, userId)).orderBy(desc(learningHistory.createdAt));
    if (limit) return await query.limit(limit);
    return await query;
  }

  async getLearningHistoryBySubject(userId: string, subject: string): Promise<LearningHistory[]> {
    return await db.select().from(learningHistory).where(and(eq(learningHistory.userId, userId), eq(learningHistory.subject, subject))).orderBy(desc(learningHistory.createdAt));
  }

  // Generated image operations
  async createGeneratedImage(image: InsertGeneratedImage): Promise<GeneratedImage> {
    const [newImage] = await db.insert(generatedImages).values(image).returning();
    return newImage;
  }

  async getGeneratedImagesByUser(userId: string): Promise<GeneratedImage[]> {
    const images = await db.select().from(generatedImages).where(eq(generatedImages.userId, userId)).orderBy(desc(generatedImages.createdAt));
    return images.map((img: any) => ({ ...img, imageUrl: (img as any).imageUrl })) as GeneratedImage[];
  }

  async getGeneratedImagesByTopic(userId: string, topic: string): Promise<GeneratedImage[]> {
    const images = await db.select().from(generatedImages).where(and(eq(generatedImages.userId, userId), eq(generatedImages.relatedTopic, topic))).orderBy(desc(generatedImages.createdAt));
    return images.map((img: any) => ({ ...img, imageUrl: (img as any).imageUrl })) as GeneratedImage[];
  }

  async deleteGeneratedImage(userId: string, imageId: string): Promise<void> {
    await db.delete(generatedImages).where(and(eq(generatedImages.userId, userId), eq(generatedImages.id, imageId)));
  }

  // Topic explanation operations
  async createTopicExplanation(explanation: InsertTopicExplanation): Promise<TopicExplanation> {
    const [newExplanation] = await db.insert(topicExplanations).values(explanation).returning();
    return newExplanation;
  }

  async getTopicExplanation(userId: string, subject: string, topic: string): Promise<TopicExplanation | undefined> {
    const [explanation] = await db.select().from(topicExplanations).where(and(eq(topicExplanations.userId, userId), eq(topicExplanations.subject, subject), eq(topicExplanations.topic, topic)));
    return explanation;
  }

  async getTopicExplanationsByUser(userId: string): Promise<TopicExplanation[]> {
    return await db.select().from(topicExplanations).where(eq(topicExplanations.userId, userId)).orderBy(desc(topicExplanations.createdAt));
  }

  // Notification operations
  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db.insert(notifications).values(notification).returning();
    return newNotification;
  }

  async getNotificationsByUser(userId: string, limit: number = 50): Promise<Notification[]> {
    return await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
  }

  async getNotification(id: string): Promise<Notification | undefined> {
    const [notification] = await db.select().from(notifications).where(eq(notifications.id, id));
    return notification;
  }

  async markNotificationAsRead(id: string): Promise<Notification | undefined> {
    const [notification] = await db.update(notifications).set({ read: true }).where(eq(notifications.id, id)).returning();
    return notification;
  }

  async deleteNotification(id: string): Promise<void> {
    await db.delete(notifications).where(eq(notifications.id, id));
  }

  // LIVE AI operations
  async createVoiceConversation(conversation: InsertVoiceConversation): Promise<VoiceConversation> {
    const [newConversation] = await db.insert(voiceConversations).values(conversation).returning();
    return newConversation;
  }

  async getVoiceConversationsByUser(userId: string): Promise<VoiceConversation[]> {
    return await db.select().from(voiceConversations).where(eq(voiceConversations.userId, userId)).orderBy(desc(voiceConversations.createdAt));
  }

  async createDocumentUpload(doc: InsertDocumentUpload): Promise<DocumentUpload> {
    const [newDoc] = await db.insert(documentUploads).values(doc).returning();
    return newDoc;
  }

  async updateDocumentUpload(id: string, updates: Partial<DocumentUpload>): Promise<DocumentUpload | undefined> {
    const [updated] = await db.update(documentUploads).set(updates).where(eq(documentUploads.id, id)).returning();
    return updated;
  }

  async getDocumentUploadsByUser(userId: string): Promise<DocumentUpload[]> {
    return await db.select().from(documentUploads).where(eq(documentUploads.userId, userId)).orderBy(desc(documentUploads.createdAt));
  }

  async createLiveAiFeature(feature: InsertLiveAiFeature): Promise<LiveAiFeature> {
    const [newFeature] = await db.insert(liveAiFeatures).values(feature).returning();
    return newFeature;
  }

  async getLiveAiFeaturesByUser(userId: string): Promise<LiveAiFeature[]> {
    return await db.select().from(liveAiFeatures).where(eq(liveAiFeatures.userId, userId)).orderBy(desc(liveAiFeatures.createdAt));
  }

  // CBT Mode operations
  async getCbtExam(id: string): Promise<CbtExam | undefined> {
    const [exam] = await db.select().from(cbtExams).where(eq(cbtExams.id, id));
    return exam;
  }

  async getAllCbtExams(): Promise<CbtExam[]> {
    return await db.select().from(cbtExams);
  }

  async createCbtExam(exam: InsertCbtExam): Promise<CbtExam> {
    const [newExam] = await db.insert(cbtExams).values(exam).returning();
    return newExam;
  }

  async getCbtQuestions(examId: string): Promise<CbtQuestion[]> {
    return await db.select().from(cbtQuestions).where(eq(cbtQuestions.examId, examId));
  }

  async createCbtSession(session: InsertCbtSession): Promise<CbtSession> {
    const [newSession] = await db.insert(cbtSessions).values(session).returning();
    return newSession;
  }

  async getCbtSession(id: string): Promise<CbtSession | undefined> {
    const [session] = await db.select().from(cbtSessions).where(eq(cbtSessions.id, id));
    return session;
  }

  async getCbtSessionsByUser(userId: string): Promise<CbtSession[]> {
    return await db.select().from(cbtSessions).where(eq(cbtSessions.userId, userId)).orderBy(desc(cbtSessions.startedAt));
  }

  async updateCbtSession(id: string, updates: Partial<InsertCbtSession>): Promise<CbtSession | undefined> {
    const [updated] = await db.update(cbtSessions).set(updates).where(eq(cbtSessions.id, id)).returning();
    return updated;
  }

  async createCbtAnswer(answer: InsertCbtAnswer): Promise<CbtAnswer> {
    const [newAnswer] = await db.insert(cbtAnswers).values(answer).returning();
    return newAnswer;
  }

  async getCbtAnswersBySession(sessionId: string): Promise<CbtAnswer[]> {
    return await db.select().from(cbtAnswers).where(eq(cbtAnswers.sessionId, sessionId));
  }

  // CBT Exam History operations
  async createCbtExamHistory(exam: any): Promise<any> {
    const [newExam] = await db.insert(cbtExamHistory).values(exam).returning();
    return newExam;
  }

  async getCbtExamHistoryByUser(userId: string): Promise<any[]> {
    return await db.select().from(cbtExamHistory).where(eq(cbtExamHistory.userId, userId)).orderBy(desc(cbtExamHistory.createdAt));
  }

  async deleteCbtExamHistory(id: string): Promise<void> {
    await db.delete(cbtExamHistory).where(eq(cbtExamHistory.id, id));
  }

  // CBT Analytics operations
  async updateCbtAnalytics(userId: string, topic: string, isStrong: boolean): Promise<any> {
    const existing = await db.select().from(cbtAnalytics).where(and(eq(cbtAnalytics.userId, userId), eq(cbtAnalytics.topic, topic)));
    if (existing.length > 0) {
      const [updated] = await db.update(cbtAnalytics).set({ isStrong, updatedAt: new Date() }).where(and(eq(cbtAnalytics.userId, userId), eq(cbtAnalytics.topic, topic))).returning();
      return updated;
    } else {
      const [newAnalytics] = await db.insert(cbtAnalytics).values({ userId, topic, isStrong }).returning();
      return newAnalytics;
    }
  }

  async getCbtAnalyticsByUser(userId: string): Promise<any> {
    return await db.select().from(cbtAnalytics).where(eq(cbtAnalytics.userId, userId));
  }

  // CBT Question operations
  async createCbtQuestion(question: any): Promise<any> {
    const [newQuestion] = await db.insert(cbtQuestions).values(question).returning();
    return newQuestion;
  }

  async createCbtQuestionLicensing(licensing: any): Promise<any> {
    const [newLicensing] = await db.insert(cbtQuestionLicensing).values(licensing).returning();
    return newLicensing;
  }

  async getCbtQuestionLicensing(questionId: string): Promise<any> {
    const [licensing] = await db.select().from(cbtQuestionLicensing).where(eq(cbtQuestionLicensing.questionId, questionId));
    return licensing;
  }

  // Recording operations
  async createRecording(recording: InsertRecording): Promise<Recording> {
    const [newRecording] = await db.insert(recordings).values(recording).returning();
    return newRecording;
  }

  async getRecordingsByUser(userId: string): Promise<Recording[]> {
    return await db.select().from(recordings).where(eq(recordings.userId, userId)).orderBy(desc(recordings.createdAt));
  }

  async deleteRecording(id: string): Promise<void> {
    await db.delete(recordings).where(eq(recordings.id, id));
  }

  // Generated Lesson operations
  async createGeneratedLesson(lesson: InsertGeneratedLesson): Promise<GeneratedLesson> {
    const [newLesson] = await db.insert(generatedLessons).values(lesson).returning();
    return newLesson;
  }

  async getGeneratedLessonsByUser(userId: string): Promise<GeneratedLesson[]> {
    return await db.select().from(generatedLessons).where(eq(generatedLessons.userId, userId)).orderBy(desc(generatedLessons.createdAt));
  }

  async deleteGeneratedLesson(id: string): Promise<void> {
    await db.delete(generatedLessons).where(eq(generatedLessons.id, id));
  }

  // Project workspace operations (in-memory cache)
  private projectCache = new Map<string, any>();
  private projectFileCache = new Map<string, any>();
  private projectTaskCache = new Map<string, any>();
  private projectIdCounter = 0;

  async getProjectsByUser(userId: string): Promise<any[]> {
    return Array.from(this.projectCache.values()).filter((p: any) => p.userId === userId);
  }

  async createProject(project: any): Promise<any> {
    const id = `proj_${++this.projectIdCounter}_${Date.now()}`;
    const fullProject = { id, ...project, createdAt: new Date(), updatedAt: new Date() };
    this.projectCache.set(id, fullProject);
    return fullProject;
  }

  async updateProject(id: string, updates: any): Promise<any> {
    const project = this.projectCache.get(id);
    if (project) {
      const updated = { ...project, ...updates, updatedAt: new Date() };
      this.projectCache.set(id, updated);
      return updated;
    }
    return undefined;
  }

  async deleteProject(id: string): Promise<void> {
    this.projectCache.delete(id);
  }

  async getFilesByProject(projectId: string): Promise<any[]> {
    return Array.from(this.projectFileCache.values()).filter((f: any) => f.projectId === projectId);
  }

  async createFile(file: any): Promise<any> {
    const id = `file_${++this.projectIdCounter}_${Date.now()}`;
    const fullFile = { id, ...file, createdAt: new Date() };
    this.projectFileCache.set(id, fullFile);
    return fullFile;
  }

  async deleteFile(id: string): Promise<void> {
    this.projectFileCache.delete(id);
  }

  async getTasksByProject(projectId: string): Promise<any[]> {
    return Array.from(this.projectTaskCache.values()).filter((t: any) => t.projectId === projectId);
  }

  async createTask(task: any): Promise<any> {
    const id = `task_${++this.projectIdCounter}_${Date.now()}`;
    const fullTask = { id, ...task, createdAt: new Date() };
    this.projectTaskCache.set(id, fullTask);
    return fullTask;
  }

  async updateTask(id: string, updates: any): Promise<any> {
    const task = this.projectTaskCache.get(id);
    if (task) {
      const updated = { ...task, ...updates, updatedAt: new Date() };
      this.projectTaskCache.set(id, updated);
      return updated;
    }
    return undefined;
  }

  async deleteTask(id: string): Promise<void> {
    this.projectTaskCache.delete(id);
  }
}

// ─── Supabase-backed Storage ──────────────────────────────────────────────────
// CRITICAL FIX: createChatSession, createChatMessage, createFileUpload,
// createMemoryEntry, createGeneratedLesson, upsertUser, and updateUser
// used to call super.xxx() first, which routes through the FAKE stub `db`
// object in db.ts (every method on it just returns []). That made
// `[newSession] = await db.insert(...).returning()` always come back
// undefined, which crashed the moment the code tried to read `.id` off it.
//
// Fix: generate the ID ourselves and write directly to the REAL Supabase
// client (`supabaseDb`), which is the one thing in this file that actually
// works. No more routing through the fake db at all for these paths.
class SupabaseStorage extends DatabaseStorage {
  // ── Users ───────────────────────────────────────────────────────────────────
  async getUsers(): Promise<User[]> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb.from('users').select('*').order('created_at', { ascending: false });
        if (!error && data) return data.map(mapSupabaseUser);
      } catch (e) {}
    }
    return super.getUsers();
  }

  async getUser(id: string): Promise<User | undefined> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb.from('users').select('*').eq('id', id).single();
        if (!error && data) return mapSupabaseUser(data);
      } catch {}
    }
    return super.getUser(id);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const now = new Date().toISOString();
    if (supabaseDb) {
      try {
        const row = {
          id: userData.id,
          email: userData.email || '',
          first_name: userData.firstName || null,
          last_name: userData.lastName || null,
          profile_image_url: userData.profileImageUrl || null,
          role: 'student',
          subscription_tier: 'free',
          updated_at: now,
        };
        const { data, error } = await supabaseDb.from('users').upsert(row, { onConflict: 'id' }).select().single();
        if (error) console.error("🔥 Failed to upsert user to Supabase:", error.message, error.details, error.hint);
        if (!error && data) return mapSupabaseUser(data);
      } catch (e) {
        console.error("🔥 upsertUser Supabase error:", e);
      }
    }
    // Fallback so the caller never gets undefined, even if Supabase failed
    return {
      id: userData.id,
      email: userData.email || '',
      firstName: userData.firstName || null,
      lastName: userData.lastName || null,
      profileImageUrl: userData.profileImageUrl || null,
      role: 'student',
      schoolId: null,
      subscriptionTier: 'free',
      subscriptionExpiresAt: null,
      paystackCustomerId: null,
      lenoryId: null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    } as User;
  }

  async updateUser(id: string, updates: any): Promise<User | undefined> {
    if (supabaseDb) {
      try {
        const row: any = { updated_at: new Date().toISOString() };
        if (updates.firstName !== undefined) row.first_name = updates.firstName;
        if (updates.lastName !== undefined) row.last_name = updates.lastName;
        if (updates.profileImageUrl !== undefined) row.profile_image_url = updates.profileImageUrl;
        if (updates.subscriptionTier !== undefined) row.subscription_tier = updates.subscriptionTier;
        if (updates.subscriptionExpiresAt !== undefined) row.subscription_expires_at = updates.subscriptionExpiresAt;
        if (updates.paystackCustomerId !== undefined) row.paystack_customer_id = updates.paystackCustomerId;
        const { data, error } = await supabaseDb.from('users').update(row).eq('id', id).select().single();
        if (error) console.error("🔥 Failed to update user in Supabase:", error.message, error.details, error.hint);
        if (!error && data) return mapSupabaseUser(data);
      } catch (e) {
        console.error("🔥 updateUser Supabase error:", e);
      }
    }
    return this.getUser(id);
  }

  // ── Chat Sessions ───────────────────────────────────────────────────────────
  async createChatSession(session: InsertChatSession): Promise<ChatSession> {
    const id = nanoid();
    const now = new Date().toISOString();
    const sessionRow = {
      id,
      user_id: session.userId,
      title: session.title || 'New Chat',
      mode: session.mode || 'chat',
      summary: session.summary || '',
      is_bookmarked: (session as any).isBookmarked || false,
      message_count: 0,
      created_at: now,
      updated_at: now,
    };
    if (supabaseDb) {
      try {
        const { error } = await supabaseDb.from('chat_sessions').upsert(sessionRow);
        if (error) console.error("🔥 Failed to save chat session to Supabase:", error.message, error.details, error.hint);
      } catch (e) {
        console.error("🔥 createChatSession Supabase error:", e);
      }
    }
    return {
      id,
      userId: session.userId,
      title: sessionRow.title,
      mode: sessionRow.mode,
      summary: sessionRow.summary,
      messageCount: 0,
      isBookmarked: sessionRow.is_bookmarked,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    } as ChatSession;
  }

  async getChatSessionsByUser(userId: string): Promise<ChatSession[]> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb
          .from('chat_sessions').select('*').eq('user_id', userId)
          .order('is_bookmarked', { ascending: false })
          .order('updated_at', { ascending: false });
        if (!error && data) {
          return data.map((s: any) => ({
            id: s.id, userId: s.user_id, title: s.title, mode: s.mode,
            summary: s.summary || '', messageCount: s.message_count || 0,
            isBookmarked: s.is_bookmarked || false,
            createdAt: new Date(s.created_at), updatedAt: new Date(s.updated_at),
          })) as ChatSession[];
        }
      } catch {}
    }
    return [];
  }

  async getChatSession(id: string): Promise<ChatSession | undefined> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb.from('chat_sessions').select('*').eq('id', id).single();
        if (!error && data) {
          return {
            id: data.id, userId: data.user_id, title: data.title, mode: data.mode,
            summary: data.summary || '', messageCount: data.message_count || 0,
            isBookmarked: data.is_bookmarked || false,
            createdAt: new Date(data.created_at), updatedAt: new Date(data.updated_at),
          } as ChatSession;
        }
      } catch {}
    }
    return undefined;
  }

  async updateChatSession(id: string, updates: Partial<InsertChatSession>): Promise<ChatSession | undefined> {
    if (supabaseDb) {
      try {
        const updateData: any = { updated_at: new Date().toISOString() };
        if (updates.title !== undefined) updateData.title = updates.title;
        if (updates.mode !== undefined) updateData.mode = updates.mode;
        if (updates.summary !== undefined) updateData.summary = updates.summary;
        if ((updates as any).isBookmarked !== undefined) updateData.is_bookmarked = (updates as any).isBookmarked;
        const { error } = await supabaseDb.from('chat_sessions').update(updateData).eq('id', id);
        if (error) console.error("🔥 Failed to update chat session in Supabase:", error.message, error.details, error.hint);
      } catch (e) {
        console.error("🔥 updateChatSession Supabase error:", e);
      }
    }
    return this.getChatSession(id);
  }

  async deleteChatSession(id: string): Promise<void> {
    if (supabaseDb) {
      try {
        await supabaseDb.from('chat_sessions').delete().eq('id', id);
        await supabaseDb.from('chat_messages').delete().eq('session_id', id);
      } catch (e) {
        console.error("🔥 deleteChatSession Supabase error:", e);
      }
    }
  }

  // ── Chat Messages ───────────────────────────────────────────────────────────
  async createChatMessage(msg: InsertChatMessage): Promise<ChatMessage> {
    const id = nanoid();
    const now = new Date().toISOString();
    const messageRow = {
      id,
      user_id: msg.userId,
      session_id: msg.sessionId || null,
      role: msg.role,
      content: msg.content,
      attachments: msg.attachments ? JSON.stringify(msg.attachments) : null,
      created_at: now,
    };
    if (supabaseDb) {
      try {
        const { error } = await supabaseDb.from('chat_messages').insert(messageRow);
        if (error) console.error("🔥 Failed to save chat message to Supabase:", error.message, error.details, error.hint);
        if (msg.sessionId) {
          try {
            await supabaseDb.rpc('increment_message_count', { session_id: msg.sessionId });
          } catch (e) {
            console.error("🔥 increment_message_count RPC failed (non-critical):", e);
          }
        }
      } catch (e) {
        console.error("🔥 createChatMessage Supabase error:", e);
      }
    }
    return {
      id,
      userId: msg.userId,
      sessionId: msg.sessionId || null,
      role: msg.role,
      content: msg.content,
      attachments: msg.attachments || null,
      createdAt: new Date(now),
    } as ChatMessage;
  }

  async getChatMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb
          .from('chat_messages').select('*').eq('session_id', sessionId)
          .order('created_at', { ascending: true });
        if (!error && data) {
          return data.map((m: any) => ({
            id: m.id, userId: m.user_id, sessionId: m.session_id, role: m.role, content: m.content,
            attachments: m.attachments ? (typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments) : null,
            createdAt: new Date(m.created_at),
          })) as ChatMessage[];
        }
      } catch {}
    }
    return [];
  }

  async getChatMessagesByUser(userId: string, limit = 500): Promise<ChatMessage[]> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb
          .from('chat_messages').select('*').eq('user_id', userId)
          .order('created_at', { ascending: false }).limit(limit);
        if (!error && data) {
          return data.map((m: any) => ({
            id: m.id, userId: m.user_id, sessionId: m.session_id, role: m.role, content: m.content,
            attachments: m.attachments ? (typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments) : null,
            createdAt: new Date(m.created_at),
          })) as ChatMessage[];
        }
      } catch {}
    }
    return [];
  }

  async deleteChatMessagesByUser(userId: string): Promise<void> {
    if (supabaseDb) {
      try {
        await supabaseDb.from('chat_messages').delete().eq('user_id', userId);
      } catch (e) {
        console.error("🔥 deleteChatMessagesByUser Supabase error:", e);
      }
    }
  }

  // ── Generated Lessons ───────────────────────────────────────────────────────
  async createGeneratedLesson(l: InsertGeneratedLesson): Promise<GeneratedLesson> {
    const id = nanoid();
    const now = new Date().toISOString();
    if (supabaseDb) {
      try {
        const { error } = await supabaseDb.from('generated_lessons').insert({
          id,
          user_id: l.userId,
          recording_id: l.recordingId || null,
          title: l.title,
          objectives: l.objectives || [],
          key_points: l.keyPoints || [],
          summary: l.summary || '',
          original_text: l.originalText || null,
          created_at: now,
        });
        if (error) console.error("🔥 Failed to save generated lesson to Supabase:", error.message, error.details, error.hint);
      } catch (e) {
        console.error("🔥 createGeneratedLesson Supabase error:", e);
      }
    }
    return {
      id, userId: l.userId, recordingId: l.recordingId || null, title: l.title,
      objectives: l.objectives || [], keyPoints: l.keyPoints || [], summary: l.summary || '',
      originalText: l.originalText || null, createdAt: new Date(now),
    } as GeneratedLesson;
  }

  async getGeneratedLessonsByUser(userId: string): Promise<GeneratedLesson[]> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb
          .from('generated_lessons').select('*').eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (!error && data) {
          return data.map((l: any) => ({
            id: l.id, userId: l.user_id, recordingId: l.recording_id,
            title: l.title, objectives: l.objectives || [],
            keyPoints: l.key_points || [], summary: l.summary || '',
            originalText: l.original_text || null, createdAt: new Date(l.created_at),
          })) as GeneratedLesson[];
        }
      } catch {}
    }
    return [];
  }

  async deleteGeneratedLesson(id: string): Promise<void> {
    if (supabaseDb) {
      try { await supabaseDb.from('generated_lessons').delete().eq('id', id); } catch (e) {
        console.error("🔥 deleteGeneratedLesson Supabase error:", e);
      }
    }
  }

  // ── Memory Entries ──────────────────────────────────────────────────────────
  async createMemoryEntry(entry: InsertMemoryEntry): Promise<MemoryEntry> {
    const id = nanoid();
    const now = new Date().toISOString();
    if (supabaseDb) {
      try {
        const { error } = await supabaseDb.from('memory_entries').insert({
          id,
          user_id: entry.userId,
          type: (entry as any).type || 'note',
          subject: (entry as any).subject || null,
          content: (entry as any).content || ((entry as any).data ? JSON.stringify((entry as any).data) : ''),
          importance: (entry as any).importance || 1,
          created_at: now,
        });
        if (error) console.error("🔥 Failed to save memory entry to Supabase:", error.message, error.details, error.hint);
      } catch (e) {
        console.error("🔥 createMemoryEntry Supabase error:", e);
      }
    }
    return {
      id, userId: entry.userId, type: (entry as any).type,
      data: (entry as any).data || {}, createdAt: new Date(now),
    } as unknown as MemoryEntry;
  }

  async getMemoryEntriesByUser(userId: string): Promise<MemoryEntry[]> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb
          .from('memory_entries').select('*').eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (!error && data) {
          return data.map((m: any) => ({
            id: m.id, userId: m.user_id, type: m.type, subject: m.subject,
            data: m.content ? { content: m.content } : {},
            createdAt: new Date(m.created_at),
          })) as unknown as MemoryEntry[];
        }
      } catch {}
    }
    return [];
  }

  // ── File Uploads ────────────────────────────────────────────────────────────
  async createFileUpload(upload: InsertFileUpload): Promise<FileUpload> {
    const id = nanoid();
    const now = new Date().toISOString();
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb.from('document_uploads').insert({
          id,
          user_id: upload.userId,
          file_name: upload.fileName,
          file_type: upload.fileType,
          file_size: upload.fileSize,
          file_url: upload.fileUrl,
          extracted_text: upload.extractedText || null,
          is_processing: upload.processingStatus === 'pending',
          created_at: now,
        }).select().single();
        if (error) console.error("🔥 Failed to save file upload to Supabase:", error.message, error.details, error.hint);
        if (!error && data) return mapDocumentUploadRow(data);
      } catch (e) {
        console.error("🔥 createFileUpload Supabase error:", e);
      }
    }
    return {
      id, userId: upload.userId, fileName: upload.fileName, fileType: upload.fileType,
      fileSize: upload.fileSize, fileUrl: upload.fileUrl, extractedText: upload.extractedText || null,
      processingStatus: upload.processingStatus || 'pending', createdAt: new Date(now),
    } as FileUpload;
  }

  async getFileUploadsByUser(userId: string): Promise<FileUpload[]> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb
          .from('document_uploads').select('*').eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (!error && data) return data.map(mapDocumentUploadRow);
      } catch {}
    }
    return [];
  }

  async getFileUpload(id: string): Promise<FileUpload | undefined> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb.from('document_uploads').select('*').eq('id', id).single();
        if (!error && data) return mapDocumentUploadRow(data);
      } catch {}
    }
    return undefined;
  }

  async updateFileUploadStatus(id: string, status: string, extractedText?: string): Promise<FileUpload | undefined> {
    if (supabaseDb) {
      try {
        const updateData: any = { is_processing: status === 'pending' };
        if (extractedText) updateData.extracted_text = extractedText;
        const { data, error } = await supabaseDb.from('document_uploads').update(updateData).eq('id', id).select().single();
        if (error) console.error("🔥 Failed to update file upload in Supabase:", error.message, error.details, error.hint);
        if (!error && data) return mapDocumentUploadRow(data);
      } catch (e) {
        console.error("🔥 updateFileUploadStatus Supabase error:", e);
      }
    }
    return this.getFileUpload(id);
  }

  async deleteFileUpload(id: string): Promise<void> {
    if (supabaseDb) {
      try {
        await supabaseDb.from('document_uploads').delete().eq('id', id);
      } catch (e) {
        console.error("🔥 deleteFileUpload Supabase error:", e);
      }
    }
  }

  // ── Exam Results & User Progress ────────────────────────────────────────────
  // These previously had NO override at all, so they fell through to the base
  // DatabaseStorage methods, which call the FAKE db stub's `.orderBy()` —
  // a method that stub doesn't even have. That was your other crash:
  // "db.select(...).from(...).where(...).orderBy is not a function".
  // NOTE: this assumes Supabase tables named `exam_results` / `user_progress`
  // with a `user_id` column — adjust the table/column names below if yours differ.
  async getExamResultsByUser(userId: string): Promise<ExamResult[]> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb
          .from('exam_results').select('*').eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (!error && data) return data as any;
        if (error) console.error("🔥 getExamResultsByUser Supabase error:", error.message);
      } catch (e) {
        console.error("🔥 getExamResultsByUser Supabase error:", e);
      }
    }
    return [];
  }

  async getUserProgressByUser(userId: string): Promise<UserProgress[]> {
    if (supabaseDb) {
      try {
        const { data, error } = await supabaseDb
          .from('user_progress').select('*').eq('user_id', userId);
        if (!error && data) return data as any;
        if (error) console.error("🔥 getUserProgressByUser Supabase error:", error.message);
      } catch (e) {
        console.error("🔥 getUserProgressByUser Supabase error:", e);
      }
    }
    return [];
  }
}

function mapDocumentUploadRow(data: any): FileUpload {
  return {
    id: data.id,
    userId: data.user_id,
    fileName: data.file_name,
    fileType: data.file_type,
    fileSize: data.file_size,
    fileUrl: data.file_url,
    extractedText: data.extracted_text || null,
    processingStatus: data.is_processing ? 'pending' : 'completed',
    createdAt: data.created_at ? new Date(data.created_at) : new Date(),
  } as FileUpload;
}

function mapSupabaseUser(data: any): User {
  return {
    id: data.id,
    email: data.email,
    firstName: data.first_name || null,
    lastName: data.last_name || null,
    profileImageUrl: data.profile_image_url || null,
    role: data.role || 'student',
    schoolId: data.school_id || null,
    subscriptionTier: data.subscription_tier || 'free',
    subscriptionExpiresAt: data.subscription_expires_at ? new Date(data.subscription_expires_at) : null,
    paystackCustomerId: data.paystack_customer_id || null,
    lenoryId: data.lenory_id || null,
    createdAt: data.created_at ? new Date(data.created_at) : new Date(),
    updatedAt: data.updated_at ? new Date(data.updated_at) : new Date(),
  } as User;
}

export async function initSupabaseSchema() {
  if (!supabaseDb) return;
  try {
    const { error } = await supabaseDb.from('users').select('id').limit(1);
    if (!error) {
      console.log('✅ Supabase users table is ready');
    } else {
      console.log('ℹ️ Supabase users table note:', error.message?.substring(0, 80));
      console.log('  → To enable full persistence: run the SQL from /api/admin/init-db in Supabase dashboard');
    }
  } catch {}
}

export const storage = new SupabaseStorage();
console.log('✅ Storage initialized (Supabase + Database hybrid)');