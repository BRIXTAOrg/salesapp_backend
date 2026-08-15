// src/getRoutes/pjp.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { permanentJourneyPlans, dealers, influencers, institutions } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupPjpRoutes(app: Express) {
  app.get("/api/salesApp/permanent-journey-plans", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;

      const pjps = await db
        .select({
          id: permanentJourneyPlans.id,
          userId: permanentJourneyPlans.userId,
          createdById: permanentJourneyPlans.createdById,
          planDate: permanentJourneyPlans.planDate,
          areaToBeVisited: permanentJourneyPlans.areaToBeVisited,
          description: permanentJourneyPlans.description,
          status: permanentJourneyPlans.status,
          verificationStatus: permanentJourneyPlans.verificationStatus,
          additionalVisitRemarks: permanentJourneyPlans.additionalVisitRemarks,
          route: permanentJourneyPlans.route,
          diversionReason: permanentJourneyPlans.diversionReason,
          dealerId: permanentJourneyPlans.dealerId,
          bulkOpId: permanentJourneyPlans.bulkOpId,
          institutionId: permanentJourneyPlans.institutionId,
          influencerId: permanentJourneyPlans.influencerId,
          idempotencyKey: permanentJourneyPlans.idempotencyKey,
          createdAt: permanentJourneyPlans.createdAt,
          updatedAt: permanentJourneyPlans.updatedAt,
          
          visitDealerName: dealers.dealerPartyName,
          visitInstitutionName: institutions.institutionName,
          visitInfluencerName: influencers.contactPersonName,
          noOfDealerVisits: permanentJourneyPlans.noOfDealerVisits,
          noOfInstitutionVisits: permanentJourneyPlans.noOfInstitutionVisits,
          noOfInfluencerVisits: permanentJourneyPlans.noOfInfluencerVisits,
        })
        .from(permanentJourneyPlans)
        .leftJoin(dealers, eq(permanentJourneyPlans.dealerId, dealers.id))
        .leftJoin(institutions, eq(permanentJourneyPlans.institutionId, institutions.id))
        .leftJoin(influencers, eq(permanentJourneyPlans.influencerId, influencers.id))
        .where(eq(permanentJourneyPlans.userId, userId))
        .orderBy(desc(permanentJourneyPlans.planDate));

      return res.status(200).json({ success: true, data: pjps });
    } catch (err: any) {
      console.error("Error fetching PJPs:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  });
}