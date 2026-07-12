# Final Whistle — single-container deployment (keeper + API + static UI)
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install --workspaces --include-workspace-root
COPY . .
RUN npm run build -w web

FROM node:22-slim
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["npm", "start", "-w", "server"]
