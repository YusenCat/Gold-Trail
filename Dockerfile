FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node apps/server ./apps/server
COPY --chown=node:node apps/web ./apps/web
COPY --chown=node:node packages/rules/src ./packages/rules/src
COPY --chown=node:node content ./content
RUN mkdir -p /data/saves && chown -R node:node /data
USER node
ENV PORT=4173 GAME_MODE=public GAME_SAVE_DIR=/data/saves
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node --input-type=module -e "const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/api/health');if(!r.ok)process.exit(1)"
CMD ["node", "apps/server/server.ts"]
