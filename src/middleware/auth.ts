// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development";

export interface AuthUserPayload {
    userId: number;
    email: string;
    username: string | null;
    orgRole: string;
    phoneNumber?: string | null;
    area?: string | null;
    zone?: string | null;
}

export interface AuthRequest extends Request {
    user?: AuthUserPayload;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <TOKEN>"

    if (!token) {
        return res.status(401).json({ 
            success: false, 
            error: "Access token missing." 
        });
    }

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
        if (err) {
            return res.status(401).json({ 
                success: false, 
                error: "Session expired or invalid token." 
            });
        }
        req.user = decoded as AuthUserPayload;
        next();
    });
}