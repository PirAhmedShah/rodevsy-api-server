FROM node:24-alpine3.22

WORKDIR /app

# Step 1: Only copy files that define dependencies
COPY pnpm-lock.yaml package.json ./

RUN corepack enable
# Step 2: Install (Docker caches this unless the files above change)
RUN pnpm install

# Step 3: Copy the rest of the source code
COPY . .

RUN pnpm build

EXPOSE 8080
ENTRYPOINT ["pnpm", "start"]