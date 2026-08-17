// src/postRoutes/tadabill.ts 
import { Express, Response } from "express"; 
import { tadaBills, tadaBillItems } from "../db/schema"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 
import crypto from "crypto"; 

export default function setupTadaBillPostRoutes(app: Express) {   
  app.post("/api/salesApp/tada-bills", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const userId = req.user!.userId;              
      const { id, createdAt, updatedAt, items, fromDate, toDate, ...safeBody } = req.body;              
      const newBillId = crypto.randomUUID();       
      const billPayload = {         
        ...safeBody,         
        id: newBillId,          
        userId: userId,          
        billDate: safeBody.billDate ? new Date(safeBody.billDate) : new Date(),         
        fromDate: fromDate ? new Date(fromDate) : null,         
        toDate: toDate ? new Date(toDate) : null,                  
        createdAt: new Date(),         
        updatedAt: new Date(),       
      };       
      const resultData = await db.transaction(async (tx) => {         
        const [newBill] = await tx.insert(tadaBills).values(billPayload).returning();         
        let insertedItems: any[] = [];                  
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
  })); 
}