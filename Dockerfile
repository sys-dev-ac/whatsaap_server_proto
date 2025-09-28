From node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8080
# Install PM2 globally
RUN npm install -g pm2

# Use PM2 to leverage clustering
CMD ["pm2", "index.js", "-i", "max"]