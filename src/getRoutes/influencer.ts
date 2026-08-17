// src/getRoutes/influencer.ts 
import { Express, Response } from "express"; 
import { influencers } from "../db/schema"; 
import { eq, and, or, desc, asc, ilike, sql, SQL } from "drizzle-orm"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupInfluencerRoutes(app: Express) {
    // =====================================================     
    // GET ALL     
    // =====================================================     
    app.get("/api/salesApp/influencers", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {             
        try {                 
            const { search, limit = '50', page = '1', zone, district, area, state, sortBy, sortDir } = req.query;                 
            const lmt = Math.max(1, Math.min(500, parseInt(String(limit), 10) || 50));                 
            const pg = Math.max(1, parseInt(String(page), 10) || 1);                 
            const offset = (pg - 1) * lmt;                 
            const conds: SQL[] = [];                 
            if (zone) conds.push(eq(influencers.zone, String(zone)));                 
            if (district) conds.push(eq(influencers.district, String(district)));                 
            if (area) conds.push(eq(influencers.area, String(area)));                 
            if (state) conds.push(eq(influencers.state, String(state)));                 
            // =================================================                 
            // SEARCH                 
            // =================================================                 
            if (search) {                     
                const s = `%${String(search).trim()}%`;                     
                conds.push(                         
                    or(                             
                        ilike(influencers.contactPersonName, s),                             
                        ilike(influencers.contactPersonNumber, s),                             
                        ilike(influencers.area, s),                             
                        ilike(influencers.district, s),                             
                        ilike(influencers.zone, s),                         
                    )!                     
                );                 
            }                 
            const whereCondition = conds.length > 0 ? and(...conds) : undefined;                 
            // =================================================                 
            // SORTING                 
            // =================================================                 
            const direction = (String(sortDir) || '').toLowerCase() == 'asc' ? 'asc' : 'desc';                 
            let orderExpr: SQL | any = desc(influencers.createdAt);                 
            if (sortBy == 'name') {                     
                orderExpr = direction == 'asc' ? asc(influencers.contactPersonName) : desc(influencers.contactPersonName);                 
            } else if (search && !sortBy) {                     
                const s = String(search).trim();                     
                orderExpr = sql`             
                    CASE               
                        WHEN ${influencers.contactPersonName} ILIKE ${s} THEN 0               
                        WHEN ${influencers.contactPersonName} ILIKE ${s + '%'} THEN 1               
                        ELSE 2             
                    END,             
                    ${influencers.contactPersonName} ASC           
                `;                 
            }                 
            // =================================================                 
            // QUERY                 
            // =================================================                 
            let query = db.select().from(influencers).$dynamic();                 
            if (whereCondition != null) {                     
                query = query.where(whereCondition);                 
            }                 
            const data = await query                     
                .orderBy(orderExpr, asc(influencers.id))                     
                .limit(lmt)                     
                .offset(offset);                 
            return res.status(200).json({ success: true, page: pg, limit: lmt, count: data.length, data });             
        } catch (err: any) {                 
            console.error("Error fetching influencers:", err);                 
            return res.status(500).json({                     
                success: false,                     
                error: "Failed to fetch influencers",                     
                details: err instanceof Error ? err.message : 'Unknown error'                 
            });             
        }         
    }));     

    // =====================================================     
    // GET SINGLE     
    // =====================================================     
    app.get("/api/salesApp/influencers/:id", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {             
        try {                 
            const { id } = req.params;                 
            const [record] = await db                     
                .select()                     
                .from(influencers)                     
                .where(eq(influencers.id, Number(id)))                     
                .limit(1);                 
            if (!record) {                     
                return res.status(404).json({ success: false, error: "Influencer not found" });                 
            }                 
            return res.status(200).json({ success: true, data: record });             
        } catch (err: any) {                 
            console.error("Error fetching influencer:", err);                 
            return res.status(500).json({ success: false, error: "Internal server error" });             
        }         
    })); 
}