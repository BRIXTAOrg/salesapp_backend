// src/postRoutes/tadabill.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { tadaBills, tadaBillItems } from "../db/schema";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import crypto from "crypto";

export default function setupTadaBillPostRoutes(app: Express) {
  app.post("/api/salesApp/tada-bills", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      // 1. Destructure to REMOVE system fields. 
      // Extract 'items' array separately to handle the child records.
      const { id, createdAt, updatedAt, items, fromDate, toDate, ...safeBody } = req.body;
      
      const newBillId = crypto.randomUUID();

      // 2. Build the payload for the main envelope table
      const billPayload = {
        ...safeBody,
        id: newBillId, 
        userId: userId, 
        billDate: safeBody.billDate ? new Date(safeBody.billDate) : new Date(),
        fromDate: fromDate ? new Date(fromDate) : null,
        toDate: toDate ? new Date(toDate) : null,
        
        // 3. Set fresh timestamps server-side
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 4. Use a transaction to ensure both the bill and its items save together
      const resultData = await db.transaction(async (tx) => {
        // Insert parent bill
        const [newBill] = await tx.insert(tadaBills).values(billPayload).returning();

        let insertedItems: any[] = [];
        
        // If the flutter app sends line items, insert them mapped to the new bill ID
        if (items && Array.isArray(items) && items.length > 0) {
            const itemsPayload = items.map((item: any) => {
                const { id: _itemId, billId: _bId, ...safeItem } = item;
                return {
                    ...safeItem,
                    id: crypto.randomUUID(),
                    billId: newBillId,
                };
            });
            
            insertedItems = await tx.insert(tadaBillItems).values(itemsPayload).returning();
        }

        return { ...newBill, items: insertedItems };
      });

      return res.status(201).json({ success: true, data: resultData });
    } catch (err: any) {
      console.error("Error creating TA/DA Bill:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  });
}