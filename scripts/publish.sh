#!/bin/sh

VERSION=${1}

# Save current git state
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git stash

# Go to the master branch
git checkout master
git pull origin master

# Generate version
sed -i.bak "s/\{\{VERSION\}\}/${VERSION}/" README.md.tmpl
cat README.md.tmpl > README.md
cat README.md.tmpl.bak > README.md.tmpl
rm README.md.tmpl.bak

# Commit version
git add README.md
git commit -m "Release version ${VERSION}"
git push origin master

# Tag version
git tag ${VERSION}
git push origin ${VERSION}

# Tag docker version
docker build -t marathon-autoscale .
docker tag marathon-autoscale bchelli/marathon-autoscale:${VERSION}
docker push bchelli/marathon-autoscale:${VERSION}

# Go back where you were
git checkout ${BRANCH}
git stash pop
