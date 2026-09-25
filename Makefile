.PHONY: test build up down logs config

test:
	python -m unittest discover -s tests -v

build:
	docker compose build --pull

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

config:
	docker compose config
