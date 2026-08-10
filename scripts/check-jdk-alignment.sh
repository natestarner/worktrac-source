#!/usr/bin/env bash
# Fails loudly if the JDK version pinned in backend/pom.xml diverges from either FROM line in
# backend/Dockerfile. backend/Dockerfile pins BOTH the build image
# (maven:3.9-eclipse-temurin-25) and the runtime image (eclipse-temurin:25-jre-alpine) to the
# JDK declared in pom.xml's <java.version> -- the three are meant to always agree.
#
# This exists because Dependabot's own version parsing can't be trusted to catch a mismatch:
# PR #149 (2026-08-09) bumped the build image's JDK 25->26 while pom.xml and the runtime image
# stayed on 25, and Dependabot classified it as a minor/patch update -- it only reads the
# compound tag's leading "3.9"->"3" segment, never the trailing "-eclipse-temurin-26" JDK jump.
# See .github/dependabot.yml's docker-minor-and-patch group for the grouping-side fix; this
# script is the backstop that catches a mismatch regardless of how it was introduced (Dependabot,
# a manual edit, anything).
set -euo pipefail

cd "$(dirname "$0")/.."

POM_JAVA=$(sed -nE 's#.*<java\.version>([0-9]+)</java\.version>.*#\1#p' backend/pom.xml | head -1)
BUILD_JDK=$(sed -nE 's#^FROM maven:[0-9.]+-eclipse-temurin-([0-9]+) AS build$#\1#p' backend/Dockerfile)
RUNTIME_JDK=$(sed -nE 's#^FROM eclipse-temurin:([0-9]+)-jre-alpine$#\1#p' backend/Dockerfile)

if [ -z "$POM_JAVA" ] || [ -z "$BUILD_JDK" ] || [ -z "$RUNTIME_JDK" ]; then
  echo "check-jdk-alignment: could not extract one or more versions (pom='$POM_JAVA' build='$BUILD_JDK' runtime='$RUNTIME_JDK')." >&2
  echo "backend/pom.xml or backend/Dockerfile's format changed in a way this check's parsing doesn't handle -- update the sed patterns above." >&2
  exit 1
fi

if [ "$POM_JAVA" != "$BUILD_JDK" ] || [ "$POM_JAVA" != "$RUNTIME_JDK" ]; then
  echo "JDK version mismatch:" >&2
  echo "  backend/pom.xml <java.version>:                  $POM_JAVA" >&2
  echo "  backend/Dockerfile build-stage (maven image):     $BUILD_JDK" >&2
  echo "  backend/Dockerfile runtime-stage (temurin image): $RUNTIME_JDK" >&2
  echo "" >&2
  echo "A Java upgrade is a deliberate, coordinated change -- bump pom.xml and BOTH Dockerfile" >&2
  echo "FROM lines together, in one PR, with the full backend suite run against it." >&2
  exit 1
fi

echo "check-jdk-alignment: pom.xml and both Dockerfile stages agree on JDK $POM_JAVA."
