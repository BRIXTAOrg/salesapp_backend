import crypto from "node:crypto";

import type {
  Express,
  Response,
} from "express";

import {
  createClient,
} from "@supabase/supabase-js";

import multer from "multer";

import {
  authenticateToken,
  type AuthRequest,
} from "../middleware/auth";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_BUCKET_NAME,
} = process.env;

const upload = multer({
  storage:
    multer.memoryStorage(),
  limits: {
    fileSize:
      20 * 1024 * 1024,
  },
});

function storageClient() {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !SUPABASE_BUCKET_NAME
  ) {
    throw new Error(
      "Supabase media storage is not configured.",
    );
  }

  return createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
  );
}

function safeExtension(
  fileName: string,
) {
  const extension =
    fileName
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "",
      );

  return extension
    ? `.${extension.slice(0, 12)}`
    : "";
}

/**
 * One media primitive endpoint for photo/file/signature/audio/etc.
 * The Responsibility definition decides what the URL means.
 */
export default function setupUploadRoutes(
  app: Express,
) {
  app.post(
    "/api/salesApp/media",
    authenticateToken,
    upload.single("file"),
    async (
      req: AuthRequest,
      res: Response,
    ) => {
      if (!req.file) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "No file was uploaded.",
          });
      }

      const userId =
        req.user?.userId;
      const schemaName =
        req.user?.schemaName;

      if (
        !userId ||
        !schemaName
      ) {
        return res
          .status(401)
          .json({
            success: false,
            error:
              "Unauthenticated.",
          });
      }

      try {
        const supabase =
          storageClient();

        const extension =
          safeExtension(
            req.file.originalname,
          );

        const objectKey =
          `${schemaName}/${userId}/${crypto.randomUUID()}${extension}`;

        const {
          error,
        } = await supabase.storage
          .from(
            SUPABASE_BUCKET_NAME!,
          )
          .upload(
            objectKey,
            req.file.buffer,
            {
              contentType:
                req.file.mimetype,
              upsert: false,
            },
          );

        if (error) {
          throw error;
        }

        const {
          data: publicUrlData,
        } = supabase.storage
          .from(
            SUPABASE_BUCKET_NAME!,
          )
          .getPublicUrl(
            objectKey,
          );

        return res.json({
          success: true,
          media: {
            url:
              publicUrlData.publicUrl,
            objectKey,
            mimeType:
              req.file.mimetype,
            bytes:
              req.file.size,
            originalName:
              req.file.originalname,
          },
        });
      } catch (error: any) {
        console.error(
          "Media upload failed:",
          error,
        );

        return res
          .status(500)
          .json({
            success: false,
            error:
              error?.message ??
              "Media upload failed.",
          });
      }
    },
  );
}
