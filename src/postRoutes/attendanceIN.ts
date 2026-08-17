// src/postRoutes/attendanceIN.ts 
import { Express, Response } from "express"; 
import { salesmanAttendance } from "../db/schema"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 
import { randomUUID } from "crypto"; 

export default function setupAttendanceInRoutes(app: Express) {     
    app.post("/api/salesApp/attendance/in", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {         
        try {             
            const userId = req.user!.userId;             
            const {                 
                locationName,                 
                inTimeLatitude,                 
                inTimeLongitude,                 
                inTimeImageUrl,                 
                inTimeImageCaptured             
            } = req.body;             
            const now = new Date();             
            const attendanceData = {                 
                id: randomUUID(),                 
                userId,                 
                attendanceDate: now.toISOString().substring(0, 10),                 
                locationName,                 
                inTimeTimestamp: now.toISOString(),                 
                outTimeTimestamp: null,                 
                inTimeImageCaptured: inTimeImageCaptured ?? true,                 
                outTimeImageCaptured: false,                 
                inTimeImageUrl: inTimeImageUrl ?? null,                 
                outTimeImageUrl: null,                 
                inTimeLatitude: inTimeLatitude.toString(),                 
                inTimeLongitude: inTimeLongitude.toString(),                 
                outTimeLatitude: null,                 
                outTimeLongitude: null,                 
                role: req.user!.orgRole,                 
                createdAt: now.toISOString(),                 
                updatedAt: now.toISOString(),             
            };             
            const [newAttendance] = await db                 
                .insert(salesmanAttendance)                 
                .values(attendanceData)                 
                .returning();             
            return res.status(201).json({ success: true, data: newAttendance });         
        } catch (err: any) {             
            console.error("Error marking attendance IN:", err);             
            return res.status(500).json({ success: false, error: "Internal server error" });         
        }     
    })); 
}