FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ARG SOURCEFOUNDRY_RELEASE_SHA=unknown
ENV NODE_ENV=production
ENV SOURCEFOUNDRY_RELEASE_SHA=$SOURCEFOUNDRY_RELEASE_SHA
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
CMD ["node", "dist/src/server.js"]
