// src/photoUpload/upload.ts
import { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import WebSocket from "ws"
import { authenticateToken, AuthRequest } from "../middleware/auth";

// --- Load Environment Variables ---
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_BUCKET_NAME 
} = process.env;

// --- Initialize Supabase Client ---
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {realtime: {transport: WebSocket as any}});

const upload = multer({
  storage: multer.memoryStorage(),
});

export default function setupUploadRoutes(app: Express) {
  // NOTE: this route touches no tenant tables (pure Supabase Storage
  // plumbing), so it deliberately does NOT use withTenantDb -- there's no
  // db/search_path scoping needed here. It previously had no auth at all
  // though, which meant any caller could upload to the bucket regardless
  // of login state -- added authenticateToken to close that.
  app.post("/api/supabase/photo-upload", authenticateToken, upload.single('file'), async (req: AuthRequest, res: Response) => {
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file was uploaded." });
    }

    try {
      const fileExtension = req.file.originalname.split('.').pop();
      const objectKey = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${fileExtension}`;

      // 1. Upload to Supabase 
      const { data, error } = await supabase.storage
        .from(SUPABASE_BUCKET_NAME!)
        .upload(objectKey, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (error) throw error;

      // 2. Get the Public URL from Supabase
      const { data: publicUrlData } = supabase.storage
        .from(SUPABASE_BUCKET_NAME!)
        .getPublicUrl(objectKey);

      // 3. Return the exact same JSON structure Flutter expects
      return res.json({
        success: true,
        publicUrl: publicUrlData.publicUrl
      });

    } catch (err: any) {
      console.error("Upload failed:", err);
      return res.status(500).json({ success: false, error: err.message || "Upload failed." });
    }
  });
}