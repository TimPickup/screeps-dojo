FROM node:24-bookworm@sha256:032e78d7e54e352129831743737e3a83171d9cc5b5896f411649c597ce0b11ea

RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core git \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /dojo

# Bake the engine toolchain into the image so first run needs NO fragile runtime
# install. node_modules lands at /dojo/node_modules; the compose named volume
# mounted there is initialised from this on first run. (The runtime bootstrap
# install remains as a fallback if the volume is ever empty.)
COPY package.json package-lock.json ./
COPY server-mock-patches ./server-mock-patches
COPY tools/mockEnginePatches.cjs ./tools/mockEnginePatches.cjs
# --foreground-scripts streams the slow native builds (isolated-vm compile,
# screeps-server-mockup TypeScript build, ffmpeg download) so the build shows
# activity instead of sitting silent for minutes.
#
# --loglevel=error drops npm's deprecation warnings and its "new major version"
# notice. None of them are actionable, and they were actively misleading: they
# are the LAST thing printed before npm goes quiet for ~5 minutes to fetch 682
# packages, so a healthy build looked like it had died on a jquery warning.
# Script output is stdout from the scripts themselves, so --foreground-scripts
# still streams the part that means something.
RUN npm ci --no-audit --no-fund --foreground-scripts --loglevel=error

CMD ["bash"]
