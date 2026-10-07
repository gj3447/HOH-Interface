"""Offline RDF/SHACL and JSON Schema verification. No remote context loading."""
import json
from pathlib import Path

from jsonschema import Draft202012Validator
from pyshacl import validate
from rdflib import Graph, URIRef

ROOT = Path(__file__).resolve().parents[1]


def document(relative):
    return json.loads((ROOT / relative).read_text())


def local_contexts(value):
    if isinstance(value, dict):
        if "@context" in value and not isinstance(value["@context"], dict):
            raise ValueError("Only embedded contexts are allowed by this offline verifier")
        for child in value.values():
            local_contexts(child)
    elif isinstance(value, list):
        for child in value:
            local_contexts(child)


graph = Graph()
for name in ("hoh-ui", "realtime", "semantic-content"):
    data = document(f"graph/{name}.jsonld")
    local_contexts(data)
    graph.parse(data=json.dumps(data), format="json-ld")

shapes = Graph().parse(ROOT / "graph/semantic-content-shapes.ttl", format="turtle")
conforms, _, report = validate(graph, shacl_graph=shapes, inference="rdfs", inplace=False)
assert conforms, report

# Prove that the shape gate rejects a missing required source/authority assertion.
negative = Graph()
for triple in graph:
    negative.add(triple)
negative.remove((URIRef("urn:hoh:gui:semantic-content-protocol/v0.1-draft"), URIRef("urn:hoh:gui:authority"), None))
assert not validate(negative, shacl_graph=shapes, inference="rdfs", inplace=False)[0]

questions = document("graph/semantic-content-questions.json")["questions"]
for question in questions:
    for step in question.get("path", [question]):
        rows = graph.query("SELECT ?value WHERE { ?subject ?predicate ?value }", initBindings={
            "subject": URIRef(step["subject"]), "predicate": URIRef(step["predicate"])
        })
        actual = sorted(str(row.value) for row in rows)
        assert actual == sorted(step["expectedTargets"]), (question["id"], actual)

descriptor = document("examples/semantic/board.json")
descriptor_schema = document("protocol/descriptor.schema.json")
invoke_schema = document("protocol/invoke.schema.json")
outcome_schema = document("protocol/outcome.schema.json")
for schema in (descriptor_schema, invoke_schema, outcome_schema, descriptor["stateSchema"]):
    Draft202012Validator.check_schema(schema)
Draft202012Validator(descriptor_schema).validate(descriptor)
for action in descriptor["actions"]:
    Draft202012Validator.check_schema(action["inputSchema"])
    Draft202012Validator.check_schema(action["outputSchema"])
local_contexts(descriptor)
content_graph = Graph().parse(data=json.dumps(descriptor), format="json-ld")
assert len(list(content_graph.objects(URIRef(descriptor["id"]), URIRef("urn:hoh:content:actions")))) == 5
assert len(list(content_graph.triples((None, URIRef("urn:hoh:content:actionId"), None)))) == 5
print(json.dumps({"status": "PASS", "engineeringTriples": len(graph), "contentTriples": len(content_graph),
                  "competencyQuestions": len(questions), "shaclPositive": True, "shaclNegativeRejected": True,
                  "descriptorSchema": "2020-12", "remoteContextFetches": 0}))
