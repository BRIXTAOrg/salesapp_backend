// src/getRoutes/outlet.ts 
import { Express, Response } from "express"; 
import { outlets, distributors } from "../db/schema"; 
import { eq, and, or, desc, asc, ilike, sql, SQL, getTableColumns } from "drizzle-orm"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupOutletRoutes(app: Express) {   
  // =====================================================   
  // GET ALL OUTLETS   
  // =====================================================   
  app.get("/api/salesApp/outlets", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const { search, limit = '50', page = '1', distributorId, zone, district, area, state, city, sortBy, sortDir } = req.query;       
      // 1. Pagination Setup       
      const lmt = Math.max(1, Math.min(500, parseInt(String(limit), 10) || 50));       
      const pg = Math.max(1, parseInt(String(page), 10) || 1);       
      const offset = (pg - 1) * lmt;       
      // 2. WHERE Conditions       
      const conds: SQL[] = [];       
      if (distributorId) conds.push(eq(outlets.distributorId, Number(distributorId)));       
      if (zone) conds.push(eq(outlets.zone, String(zone)));       
      if (district) conds.push(eq(outlets.district, String(district)));       
      if (area) conds.push(eq(outlets.area, String(area)));       
      if (state) conds.push(eq(outlets.state, String(state)));       
      if (city) conds.push(eq(outlets.city, String(city)));       
      // 3. Search Logic       
      if (search) {         
        const s = `%${String(search).trim()}%`;         
        conds.push(           
          or(             
            ilike(outlets.name, s),             
            ilike(outlets.concernedPersonName, s),             
            ilike(outlets.concernedPersonPhoneNum, s),             
            ilike(outlets.gstNumber, s),             
            ilike(outlets.area, s),             
            ilike(outlets.district, s),             
            ilike(outlets.city, s)           
          )!         
        );       
      }       
      const whereCondition = conds.length > 0 ? and(...conds) : undefined;       
      // 4. Sorting Logic       
      const direction = (String(sortDir) || '').toLowerCase() === 'asc' ? 'asc' : 'desc';       
      let orderExpr: SQL | any = desc(outlets.createdAt);       
      if (sortBy === 'name') {         
        orderExpr = direction === 'asc' ? asc(outlets.name) : desc(outlets.name);       
      } else if (search && !sortBy) {         
        const s = String(search).trim();         
        orderExpr = sql`           
          CASE             
            WHEN ${outlets.name} ILIKE ${s} THEN 0             
            WHEN ${outlets.name} ILIKE ${s + '%'} THEN 1             
            ELSE 2           
          END,           
          ${outlets.name} ASC         
        `;       
      }       
      // 5. Query with left join to include distributor's name       
      let query = db         
        .select({           
          ...getTableColumns(outlets),           
          distributorName: distributors.name,           
          distributorPhone: distributors.concernedPersonPhoneNum,         
        })         
        .from(outlets)         
        .leftJoin(distributors, eq(outlets.distributorId, distributors.id))         
        .$dynamic();       
      if (whereCondition) {         
        query = query.where(whereCondition);       
      }       
      const data = await query         
        .orderBy(orderExpr, asc(outlets.id))         
        .limit(lmt)         
        .offset(offset);       
      return res.status(200).json({ success: true, page: pg, limit: lmt, count: data.length, data });     
    } catch (err: any) {       
      console.error("Error fetching outlets:", err);       
      return res.status(500).json({         
        success: false,         
        error: "Failed to fetch outlets",         
        details: err instanceof Error ? err.message : 'Unknown error'       
      });     
    }   
  }));   

  // =====================================================   
  // GET SINGLE OUTLET   
  // =====================================================   
  app.get("/api/salesApp/outlets/:id", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const { id } = req.params;       
      const [record] = await db         
        .select({           
          ...getTableColumns(outlets),           
          distributorName: distributors.name,           
          distributorPhone: distributors.concernedPersonPhoneNum,         
        })         
        .from(outlets)         
        .leftJoin(distributors, eq(outlets.distributorId, distributors.id))         
        .where(eq(outlets.id, Number(id)))         
        .limit(1);       
      if (!record) {         
        return res.status(404).json({ success: false, error: "Outlet not found" });       
      }       
      return res.status(200).json({ success: true, data: record });     
    } catch (err: any) {       
      console.error("Error fetching single outlet:", err);       
      return res.status(500).json({ success: false, error: "Internal server error" });     
    }   
  })); 
}