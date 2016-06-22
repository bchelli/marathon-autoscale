
FROM mhart/alpine-node:5.11

RUN mkdir -p /var/marathon-autoscale/
WORKDIR /var/marathon-autoscale/

COPY index.js /var/marathon-autoscale/
COPY package.json /var/marathon-autoscale/
RUN npm install


CMD [ "node", "/var/marathon-autoscale/index.js" ]
