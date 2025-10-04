import { Injectable } from '@nestjs/common';
import { AuthService } from 'src/auth/auth.service';
import { roadmap, roadMapStep } from 'lib/db/schema';
import db from '../../drizzle';

@Injectable()
export class RoadmapService {
    constructor(private readonly authService: AuthService) {

    }

    async createRoadmap(userId: string, chatId: string, topic: string) {
        const newRoadmap = await db.insert(roadmap).values({ userId, chatId, topic }).returning();
        return newRoadmap;
    }

    
    
}
