import { Controller, Get, Header, Param, Req, Res, UseInterceptors } from '@nestjs/common';
import { RouteConstraints } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DeepLinksService } from './deep-links.service';
import { CacheInterceptor, CacheTTL, CacheKey } from '@nestjs/cache-manager';

const DEEP_LINK_HOST = (process.env.DEEP_LINK_HOST || 'mobile.edulearn.fun')
  .toLowerCase()
  .trim();
const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
const QUIZ_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;
const COMMUNITY_INVITE_PATTERN = /^[A-Za-z0-9]{6,64}$/;

@Controller()
export class DeepLinksController {
  constructor(private readonly deepLinksService: DeepLinksService) {}

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60 * 60 * 24)
  @CacheKey('deep-links:apple-app-site-association')
  @RouteConstraints({ host: DEEP_LINK_HOST })
  @Get('.well-known/apple-app-site-association')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getAppleAppSiteAssociation() {
    return this.deepLinksService.getAppleAppSiteAssociation();
  }

  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60 * 60 * 24)
  @CacheKey('deep-links:assetlinks.json')
  @RouteConstraints({ host: DEEP_LINK_HOST })
  @Get('.well-known/assetlinks.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getAssetLinks() {
    return this.deepLinksService.getAssetLinks();
  }

  @RouteConstraints({ host: DEEP_LINK_HOST })
  @Get('ref/:referralCode')
  async openReferral(
    @Param('referralCode') referralCode: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    if (!REFERRAL_CODE_PATTERN.test(referralCode)) {
      return reply
        .type('text/html; charset=utf-8')
        .status(404)
        .send(this.deepLinksService.buildNotFoundPage());
    }

    this.deepLinksService.logHit(req, 'referral', referralCode);
    const html = await this.deepLinksService.buildReferralLandingPage(referralCode);
    return reply.type('text/html; charset=utf-8').status(200).send(html);
  }

  @RouteConstraints({ host: DEEP_LINK_HOST })
  @Get('quizzes/:quizId')
  async openQuiz(
    @Param('quizId') quizId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    if (!QUIZ_ID_PATTERN.test(quizId)) {
      return reply
        .type('text/html; charset=utf-8')
        .status(404)
        .send(this.deepLinksService.buildNotFoundPage());
    }

    this.deepLinksService.logHit(req, 'publicQuiz', quizId);
    const html = await this.deepLinksService.buildQuizLandingPage(quizId);
    return reply.type('text/html; charset=utf-8').status(200).send(html);
  }

  @RouteConstraints({ host: DEEP_LINK_HOST })
  @Get('community/:inviteCode')
  async openCommunity(
    @Param('inviteCode') inviteCode: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    if (!COMMUNITY_INVITE_PATTERN.test(inviteCode)) {
      return reply
        .type('text/html; charset=utf-8')
        .status(404)
        .send(this.deepLinksService.buildNotFoundPage());
    }

    this.deepLinksService.logHit(req, 'communityInvite', inviteCode);
    const html = await this.deepLinksService.buildCommunityLandingPage(inviteCode);
    return reply.type('text/html; charset=utf-8').status(200).send(html);
  }
}
