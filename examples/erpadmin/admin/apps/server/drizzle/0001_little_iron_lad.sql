ALTER TABLE "users" ADD COLUMN "externalSubject" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_externalSubject_unique" UNIQUE("externalSubject");