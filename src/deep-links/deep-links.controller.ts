import { Controller, Get, Header, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DeepLinksService } from './deep-links.service';

@Controller()
export class DeepLinksController {
  constructor(private readonly deepLinksService: DeepLinksService) {}

  @Get('.well-known/apple-app-site-association')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getAppleAppSiteAssociation() {
    return this.deepLinksService.getAppleAppSiteAssociation();
  }

  @Get('.well-known/assetlinks.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getAssetLinks() {
    return this.deepLinksService.getAssetLinks();
  }

  @Get('ref/:referralCode([A-Za-z0-9_-]{3,64})')
  openReferral(
    @Param('referralCode') referralCode: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    this.deepLinksService.logHit(req, 'referral', referralCode);
    const html = this.deepLinksService.buildReferralLandingPage(referralCode);
    return reply.type('text/html; charset=utf-8').status(200).send(html);
  }

  @Get('quizzes/:quizId([A-Za-z0-9_-]{10,64})')
  openQuiz(
    @Param('quizId') quizId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    this.deepLinksService.logHit(req, 'publicQuiz', quizId);
    const html = this.deepLinksService.buildQuizLandingPage(quizId);
    return reply.type('text/html; charset=utf-8').status(200).send(html);
  }

  @Get('community/:inviteCode([A-Za-z0-9]{6,64})')
  openCommunity(
    @Param('inviteCode') inviteCode: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    this.deepLinksService.logHit(req, 'communityInvite', inviteCode);
    const html = this.deepLinksService.buildCommunityLandingPage(inviteCode);
    return reply.type('text/html; charset=utf-8').status(200).send(html);
  }
}
