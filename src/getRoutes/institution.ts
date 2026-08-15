// src/getRoutes/institution.ts

import { Express, Response } from "express";
import { db } from "../db/db";
import { institutions } from "../db/schema";
import { eq, and, or, desc, asc, ilike, sql, SQL } from "drizzle-orm";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupInstitutionRoutes(app: Express) {

  // GET ALL INSTITUTIONS
  app.get("/api/salesApp/institutions", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const {
        search,
        limit = '50',
        page = '1',
        zone,
        district,
        area,
        state,
        sortBy,
        sortDir
      } = req.query;

      // Pagination
      const lmt = Math.max(1, Math.min(500, parseInt(String(limit), 10) || 50));
      const pg = Math.max(1, parseInt(String(page), 10) || 1);
      const offset = (pg - 1) * lmt;

      // WHERE conditions
      const conds: SQL[] = [];

      if (zone) conds.push(eq(institutions.zone, String(zone)));
      if (district) conds.push(eq(institutions.district, String(district)));
      if (area) conds.push(eq(institutions.area, String(area)));
      if (state) conds.push(eq(institutions.state, String(state)));

      // Search
      if (search) {
        const s = `%${String(search).trim()}%`;

        conds.push(
          or(
            ilike(institutions.institutionName, s),
            ilike(institutions.contactPersonName, s),
            ilike(institutions.contactPersonNumber, s),
            ilike(institutions.gstNo, s),
            ilike(institutions.area, s),
            ilike(institutions.district, s)
          )!
        );
      }

      const whereCondition = conds.length > 0
        ? and(...conds)
        : undefined;

      // Sorting
      const direction =
        (String(sortDir) || '').toLowerCase() === 'asc'
          ? 'asc'
          : 'desc';

      let orderExpr: SQL | any = desc(institutions.createdAt);

      if (sortBy === 'name') {
        orderExpr =
          direction === 'asc'
            ? asc(institutions.institutionName)
            : desc(institutions.institutionName);

      } else if (search && !sortBy) {

        const s = String(search).trim();

        orderExpr = sql`
          CASE
            WHEN ${institutions.institutionName} ILIKE ${s} THEN 0
            WHEN ${institutions.institutionName} ILIKE ${s + '%'} THEN 1
            ELSE 2
          END,
          ${institutions.institutionName} ASC
        `;
      }

      // Query
      let query = db.select().from(institutions).$dynamic();

      if (whereCondition) {
        query = query.where(whereCondition);
      }

      const data = await query
        .orderBy(orderExpr, asc(institutions.id))
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
      console.error("Error fetching institutions:", err);

      return res.status(500).json({
        success: false,
        error: "Failed to fetch institutions",
        details: err instanceof Error
          ? err.message
          : 'Unknown error'
      });
    }
  });

  // GET SINGLE INSTITUTION
  app.get("/api/salesApp/institutions/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {

      const { id } = req.params;

      const [record] = await db
        .select()
        .from(institutions)
        .where(eq(institutions.id, Number(id)))
        .limit(1);

      if (!record) {
        return res.status(404).json({
          success: false,
          error: "Institution not found"
        });
      }

      return res.status(200).json({
        success: true,
        data: record
      });

    } catch (err: any) {

      console.error("Error fetching single institution:", err);

      return res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
  });
}