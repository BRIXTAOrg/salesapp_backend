// src/getRoutes/dealer.ts
import { Express, Response } from "express";
import { dealers } from "../db/schema";
import { eq, and, or, desc, asc, ilike, sql, SQL } from "drizzle-orm";
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth";

export default function setupDealerRoutes(app: Express) {
  
  app.get("/api/salesApp/dealers", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {
    try {
      const { search, limit = '50', page = '1', zone, area, sortBy, sortDir } = req.query;

      // 1. Pagination Setup
      const lmt = Math.max(1, Math.min(500, parseInt(String(limit), 10) || 50));
      const pg = Math.max(1, parseInt(String(page), 10) || 1);
      const offset = (pg - 1) * lmt;

      // 2. Build Where Conditions
      const conds: SQL[] = [];

      // Exact Matches
      if (zone) conds.push(eq(dealers.zone, String(zone)));
      if (area) conds.push(eq(dealers.area, String(area)));

      // Debounced Search Logic
      if (search) {
        const s = `%${String(search).trim()}%`;
        conds.push(
          or(
            ilike(dealers.dealerPartyName, s),
            ilike(dealers.contactPersonNumber, s),
            ilike(dealers.gstNo, s),
            ilike(dealers.area, s)
          )!
        );
      }

      const whereCondition = conds.length > 0 ? and(...conds) : undefined;

      // 3. Smart Sorting Logic
      const direction = (String(sortDir) || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
      let orderExpr: SQL | any = desc(dealers.createdAt); // Default

      if (sortBy === 'name') {
        orderExpr = direction === 'asc' ? asc(dealers.dealerPartyName) : desc(dealers.dealerPartyName);
      } else if (search && !sortBy) {
        // SMART SORT: If searching, prioritize exact matches and "starts with", then alphabetical
        const s = String(search).trim();
        orderExpr = sql`
          CASE 
            WHEN ${dealers.dealerPartyName} ILIKE ${s} THEN 0 
            WHEN ${dealers.dealerPartyName} ILIKE ${s + '%'} THEN 1 
            ELSE 2 
          END, 
          ${dealers.dealerPartyName} ASC
        `;
      }

      // 4. Execute Query Builder
      let query = db.select().from(dealers).$dynamic();
      
      if (whereCondition) {
        query = query.where(whereCondition);
      }

      const data = await query
        .orderBy(orderExpr, asc(dealers.id)) // Fallback sort by ID to ensure stable pagination
        .limit(lmt)
        .offset(offset);
      
      return res.status(200).json({ 
        success: true, 
        page: pg, 
        limit: lmt, 
        count: data.length, 
        data 
      });

    } catch (err: any) {
      console.error("Error fetching dealers:", err);
      return res.status(500).json({ 
        success: false, 
        error: "Failed to fetch dealers",
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }));

  // Optional: Get Single Dealer by ID
  app.get("/api/salesApp/dealers/:id", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {
    try {
      const { id } = req.params;
      const [record] = await db.select().from(dealers).where(eq(dealers.id, Number(id))).limit(1);

      if (!record) {
        return res.status(404).json({ success: false, error: "Dealer not found" });
      }

      return res.status(200).json({ success: true, data: record });
    } catch (err: any) {
      console.error("Error fetching single dealer:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  }));
}