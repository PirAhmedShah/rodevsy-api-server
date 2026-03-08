FROM node:24-alpine3.22
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

WORKDIR /app

# Step 1: Only copy files that define dependencies
COPY pnpm-lock.yaml package.json ./

# Step 2: Install (Docker caches this unless the files above change)
RUN pnpm install

# Step 3: Copy the rest of the source code
COPY . .

RUN pnpm build

EXPOSE 8080
ENTRYPOINT ["pnpm", "start"]