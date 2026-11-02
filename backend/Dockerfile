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

# Runs as an unprivileged user. Nothing here needs root: the port is above 1024 and the app writes
# nothing to its own filesystem, so a compromised process cannot modify the image's files.
RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY --from=build --chown=app:app /app/target/*.jar app.jar
USER app

# Spring Boot will read these at runtime
ENV SERVER_PORT=8080
EXPOSE 8080

# ExitOnOutOfMemoryError: an exhausted heap becomes a clean exit and restart (the health probes,
# and any other replica, cover the gap) instead of a JVM limping on in an unknown state.
#
# The heap is deliberately left at the JVM's default (25% of the container's memory). Measured
# 2026-11-01 in production's 0.5 GiB container: the default settles at ~342 MiB in total, while
# MaxRAMPercentage=50/65 let the heap grow to ~449/457 MiB, leaving 55-65 MiB for metaspace,
# thread stacks and the code cache -- a smaller margin before the container is OOM-killed, for no
# observed gain. Revisit when the container is resized (docs/architecture/scaling.md).
#
# Exec form, so the JVM is PID 1 and receives the container's SIGTERM directly -- which is what
# lets Spring's graceful shutdown drain in-flight requests on a scale-in or deploy.
ENTRYPOINT ["java", "-XX:+ExitOnOutOfMemoryError", "-jar", "app.jar"]
