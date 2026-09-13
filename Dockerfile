# Use a secure, lightweight LTS Node image
FROM node:20-slim

# Set environment to production
ENV NODE_ENV=production

# Set the working directory
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install only production dependencies (saves space and memory)
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Expose port (if dashboard/endpoints are used)
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
