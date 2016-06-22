#!/bin/sh

VERSION=${1}

# Cannot create a version on not committed changes
HAS_CHANGES=$(git status --porcelain)
if [ "#${HAS_CHANGES}" != "#" ]; then
	echo "Please commit your work first"
	exit 1
fi

# Go to the master branch
git pull origin

# Generate version
sed -i.bak "s/{{VERSION}}/${VERSION}/" README.md.tmpl
cat README.md.tmpl > README.md
git checkout -- README.md.tmpl
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
