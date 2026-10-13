# Use official lightweight Python image
FROM python:3.12-slim

# Prevent Python from writing .pyc files and buffer outputs
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set container working directory
WORKDIR /app

# Install project dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code into the container
COPY . .

# Expose default API port
EXPOSE 8000

# Start Uvicorn production server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]