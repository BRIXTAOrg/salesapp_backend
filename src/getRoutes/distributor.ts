// src/getRoutes/distributor.ts 
import { Express, Response } from "express"; 
import { distributors } from "../db/schema"; 
import { eq, and, or, desc, asc, ilike, sql, SQL } from "drizzle-orm"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupDistributorRoutes(app: Express) {   
  // =====================================================   
  // GET ALL DISTRIBUTORS   
  // =====================================================   
  app.get("/api/salesApp/distributors", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const { search, limit = '50', page = '1', zone, district, area, state, city, sortBy, sortDir } = req.query;       
      // 1. Pagination Setup       
      const lmt = Math.max(1, Math.min(500, parseInt(String(limit), 10) || 50));       
      const pg = Math.max(1, parseInt(String(page), 10) || 1);       
      const offset = (pg - 1) * lmt;       
      // 2. WHERE Conditions       
      const conds: SQL[] = [];       
      if (zone) conds.push(eq(distributors.zone, String(zone)));       
      if (district) conds.push(eq(distributors.district, String(district)));       
      if (area) conds.push(eq(distributors.area, String(area)));       
      if (state) conds.push(eq(distributors.state, String(state)));       
      if (city) conds.push(eq(distributors.city, String(city)));       
      // 3. Search Logic       
      if (search) {         
        const s = `%${String(search).trim()}%`;         
        conds.push(           
          or(             
            ilike(distributors.name, s),             
            ilike(distributors.concernedPersonName, s),             
            ilike(distributors.concernedPersonPhoneNum, s),             
            ilike(distributors.gstNumber, s),             
            ilike(distributors.area, s),             
            ilike(distributors.district, s),             
            ilike(distributors.city, s)           
          )!         
        );       
      }       
      const whereCondition = conds.length > 0 ? and(...conds) : undefined;       
      // 4. Sorting Logic       
      const direction = (String(sortDir) || '').toLowerCase() === 'asc' ? 'asc' : 'desc';       
      let orderExpr: SQL | any = desc(distributors.createdAt);       
      if (sortBy === 'name') {         
        orderExpr = direction === 'asc' ? asc(distributors.name) : desc(distributors.name);       
      } else if (search && !sortBy) {         
        const s = String(search).trim();         
        orderExpr = sql`           
          CASE             
            WHEN ${distributors.name} ILIKE ${s} THEN 0             
            WHEN ${distributors.name} ILIKE ${s + '%'} THEN 1             
            ELSE 2           
          END,           
          ${distributors.name} ASC         
        `;       
      }       
      // 5. Query       
      let query = db.select().from(distributors).$dynamic();       
      if (whereCondition) {         
        query = query.where(whereCondition);       
      }       
      const data = await query         
        .orderBy(orderExpr, asc(distributors.id))         
        .limit(lmt)         
        .offset(offset);       
      return res.status(200).json({ success: true, page: pg, limit: lmt, count: data.length, data });     
    } catch (err: any) {       
      console.error("Error fetching distributors:", err);       
      return res.status(500).json({         
        success: false,         
        error: "Failed to fetch distributors",         
        details: err instanceof Error ? err.message : 'Unknown error'       
      });     
    }   
  }));   

  // =====================================================   
  // GET SINGLE DISTRIBUTOR   
  // =====================================================   
  app.get("/api/salesApp/distributors/:id", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const { id } = req.params;       
      const [record] = await db         
        .select()         
        .from(distributors)         
        .where(eq(distributors.id, Number(id)))         
        .limit(1);       
      if (!record) {         
        return res.status(404).json({ success: false, error: "Distributor not found" });       
      }       
      return res.status(200).json({ success: true, data: record });     
    } catch (err: any) {       
      console.error("Error fetching single distributor:", err);       
      return res.status(500).json({ success: false, error: "Internal server error" });     
    }   
  })); 
}