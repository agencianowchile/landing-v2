#!/bin/bash
# Doble clic para abrir el Revisor E-GO Cars en http://localhost:4321
cd "$(dirname "$0")"
(sleep 1; open http://localhost:4321) &
node server.js
