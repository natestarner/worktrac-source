# --- Build stage ---
FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /app
COPY pom.xml .
# Cache dependencies
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn package -DskipTests -B

# --- Runtime stage ---
FROM eclipse-temurin:25-jre-alpine
# eclipse-temurin's published alpine images can lag behind Alpine's own package
# repo fixes (see adoptium/containers#501, #906, #576). Pull latest patched
# packages (e.g. libexpat, p11-kit CVE fixes) at build time rather than waiting
# for Adoptium to republish the base image.
RUN apk update && apk upgrade --no-cache
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

# Spring Boot will read these at runtime
ENV SERVER_PORT=8080
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
