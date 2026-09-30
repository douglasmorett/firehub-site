"""
Valida XML da NFC-e contra os schemas oficiais (scripts/fixtures/nfce-xsd) com
lxml, e calcula o digest C14N de um elemento para conferir a assinatura por um
caminho independente do xml-crypto. Usado pelos testes scripts/teste-nfce-*.ts.

  py scripts/nfce-validar-xsd.py lote.json

lote.json = [{"xsd": "caminho.xsd", "xml": "caminho.xml", "digest": "infNFe"?}, ...]
Imprime um JSON com [{"ok": bool, "erros": [...], "digest": "base64"?}] na mesma ordem.
"""
import base64
import copy
import hashlib
import json
import sys

from lxml import etree

cache = {}


def schema(caminho):
    if caminho not in cache:
        cache[caminho] = etree.XMLSchema(etree.parse(caminho))
    return cache[caminho]


def main():
    lote = json.load(open(sys.argv[1], encoding="utf-8"))
    saida = []
    for pedido in lote:
        r = {"ok": False, "erros": []}
        try:
            doc = etree.parse(pedido["xml"])
            s = schema(pedido["xsd"])
            r["ok"] = s.validate(doc)
            r["erros"] = [f"linha {e.line}: {e.message}" for e in s.error_log][:10]
            alvo = pedido.get("digest")
            if alvo:
                el = doc.xpath(f"//*[local-name()='{alvo}']")[0]
                # C14N inclusivo 20010315 do elemento, sem comentários. Copiado para
                # uma árvore própria: o tostring(c14n) de um SUBELEMENTO no lxml
                # escreve xmlns="" nos filhos; a cópia leva o xmlns herdado para a
                # raiz, que é o que o c14n de um subconjunto do documento faz.
                c14n = etree.tostring(etree.ElementTree(copy.deepcopy(el)), method="c14n", exclusive=False, with_comments=False)
                r["digest"] = base64.b64encode(hashlib.sha1(c14n).digest()).decode()
        except Exception as e:  # noqa: BLE001
            r["erros"].append(str(e))
        saida.append(r)
    print(json.dumps(saida, ensure_ascii=False))


if __name__ == "__main__":
    main()
