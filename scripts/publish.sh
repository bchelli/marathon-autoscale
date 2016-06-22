#!/bin/sh

VERSION=${1}

git tag ${VERSION}
git push origin ${VERSION}

docker build -t marathon-autoscale .
docker tag marathon-autoscale bchelli/marathon-autoscale:${VERSION}
docker push bchelli/marathon-autoscale:${VERSION}
