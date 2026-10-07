"""Offline RDF/SHACL and JSON Schema verification. No remote context loading."""
import argparse
import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator
from pyshacl import validate
from rdflib import Graph, Literal, RDF, RDFS, URIRef

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--interaction", action="store_true", help="Also validate the interaction design profile; this does not test GUI behavior")
args = parser.parse_args()


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
names = ["hoh-ui", "realtime", "semantic-content"]
if args.interaction:
    names.append("interaction-profile")
node_ids = set()
for name in names:
    data = document(f"graph/{name}.jsonld")
    for node in data["@graph"]:
        assert node["@id"] not in node_ids, ("duplicate graph identifier", node["@id"])
        node_ids.add(node["@id"])
    local_contexts(data)
    graph.parse(data=json.dumps(data), format="json-ld")

shapes = Graph().parse(ROOT / "graph/semantic-content-shapes.ttl", format="turtle")
if args.interaction:
    shapes.parse(ROOT / "graph/interaction-shapes.ttl", format="turtle")
conforms, _, report = validate(graph, shacl_graph=shapes, inference="rdfs", inplace=False)
assert conforms, report

# Prove that the shape gate rejects a missing required source/authority assertion.
negative = Graph()
for triple in graph:
    negative.add(triple)
negative.remove((URIRef("urn:hoh:gui:semantic-content-protocol/v0.1-draft"), URIRef("urn:hoh:gui:authority"), None))
assert not validate(negative, shacl_graph=shapes, inference="rdfs", inplace=False)[0]

if args.interaction:
    # Reject two semantic regressions, not merely malformed JSON.
    edge = URIRef("urn:hoh:gui:interaction-rule/bottom-edge-agent")
    for predicate, replacement in (("gestureOrigin", None), ("scrollBoundaryRequired", Literal(True))):
        negative = Graph()
        for triple in graph:
            negative.add(triple)
        path = URIRef("urn:hoh:gui:" + predicate)
        negative.remove((edge, path, None))
        if replacement is not None:
            negative.add((edge, path, replacement))
        assert not validate(negative, shacl_graph=shapes, inference="rdfs", inplace=False)[0]

    interaction = document("graph/interaction-profile.jsonld")
    for node in interaction["@graph"]:
        if "h:path" in node:
            path = ROOT / node["h:path"]
            assert path.resolve().is_relative_to(ROOT)
            assert hashlib.sha256(path.read_bytes()).hexdigest() == node["h:sha256"], node["@id"]
        if node["@type"] == "rdf:Property":
            prop = URIRef(node["@id"])
            domain, range_ = graph.value(prop, RDFS.domain), graph.value(prop, RDFS.range)
            assert domain and range_, node["@id"]
            for subject, value in graph.subject_objects(prop):
                assert (subject, RDF.type, domain) in graph, (subject, domain)
                if str(range_).startswith("http://www.w3.org/2001/XMLSchema#"):
                    assert isinstance(value, Literal)
                    assert value.datatype == range_ or (str(range_).endswith("#string") and value.datatype is None)
                else:
                    assert (value, RDF.type, range_) in graph, (value, range_)
    observation = document("provenance/interaction-source-audit-2026-10-07.json")
    for artifact in observation["artifacts"]:
        assert hashlib.sha256((ROOT / artifact["path"]).read_bytes()).hexdigest() == artifact["sha256"]
    rule_ids = {node["@id"] for node in interaction["@graph"] if node["@type"] == "h:InteractionRule"}
    assert {row["rule"] for row in observation["observations"]} == rule_ids
    assert observation["runtimeConformance"] == "NOT_VERIFIED_FOR_NEW_PROFILE"

questions = document("graph/semantic-content-questions.json")["questions"]
if args.interaction:
    questions += document("graph/interaction-questions.json")["questions"]
for question in questions:
    for step in question.get("path", [question]):
        rows = graph.query("SELECT ?value WHERE { ?subject ?predicate ?value }", initBindings={
            "subject": URIRef(step["subject"]), "predicate": URIRef(step["predicate"])
        })
        actual = [row.value.toPython() if "expectedValues" in step else str(row.value) for row in rows]
        expected = step.get("expectedValues", step.get("expectedTargets"))
        assert sorted(actual) == sorted(expected), (question["id"], actual)

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
                  "descriptorSchema": "2020-12", "remoteContextFetches": 0,
                  "interactionProfile": "DESIGN_GRAPH_VALIDATED_NOT_GUI_CONFORMANCE" if args.interaction else "NOT_SELECTED",
                  "interactionNegativeFixturesRejected": 2 if args.interaction else 0}))
