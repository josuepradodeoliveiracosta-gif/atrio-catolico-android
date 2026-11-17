"""Exercita as atualizações de QA com APKs descartáveis no emulador do CI."""

from pathlib import Path
import re
import subprocess
import sys
from time import monotonic, sleep
import xml.etree.ElementTree as et

from scripts.qa_geral_celular_approve import PACKAGE


def adb(*args, timeout=30):
    return subprocess.run(["adb", *args], check=True, capture_output=True, text=True, timeout=timeout).stdout


def wait_screen(label):
    deadline = monotonic() + 75
    visible = {}
    device_xml = "/data/local/tmp/atrio-celular-ui.xml"
    while monotonic() < deadline:
        try:
            adb("shell", "rm", "-f", device_xml)
            adb("shell", "uiautomator", "dump", device_xml, timeout=15)
            root = et.fromstring(adb("shell", "cat", device_xml))
        except (subprocess.SubprocessError, et.ParseError):
            sleep(1)
            continue
        visible = {node.get("text"): node for node in root.iter("node") if node.get("text")}
        if label in visible:
            return visible
        sleep(1)
    raise AssertionError(f"Tela esperada {label!r}. Textos observados: {list(visible)}")


def install_and_open(apk, *, update=False):
    install_args = ("install", "-r", str(apk)) if update else ("install", str(apk))
    if "Success" not in adb(*install_args, timeout=90):
        raise AssertionError(f"Instalação de {apk.name} sem confirmação do emulador.")
    adb("shell", "am", "force-stop", PACKAGE)
    adb("shell", "am", "start", "-W", "-n", f"{PACKAGE}/br.com.atriocatolico.MainActivity")


def main(directory):
    install_and_open(directory / "37.apk")
    common = wait_screen("Configuração fictícia do QA Geral Celular validada.")
    assert "Gerar e salvar marcador" not in common
    print("Tela fictícia comum 37 exibida.", flush=True)

    install_and_open(directory / "38.apk", update=True)
    base = wait_screen("Teste de atualização · versão 38")
    assert "Nenhum marcador local salvo." in base
    button = base["Gerar e salvar marcador"]
    bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", button.get("bounds", ""))
    assert bounds and button.get("enabled") == "true"
    left, top, right, bottom = map(int, bounds.groups())
    adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
    saved = wait_screen("Marcador local salvo")
    marker, = [label for label in saved if re.fullmatch(r"[0-9a-f-]{36}", label)]
    print("Tela do par 38 exibida e marcador gravado.", flush=True)

    install_and_open(directory / "39.apk", update=True)
    updated = wait_screen("Teste de atualização · versão 39")
    assert "Marcador local salvo" in updated and marker in updated
    print("Tela do par 39 exibida com o mesmo marcador após atualização.", flush=True)

    # O APK funcional sintético é instalado sem iniciar a atividade nem conectar ao Firebase.
    package_prefs = "shared_prefs/qa-celular-atualizacao.xml"
    adb("shell", "am", "force-stop", PACKAGE)
    assert "Success" in adb("install", "-r", str(directory / "40.apk"), timeout=90)
    assert re.search(r"\bversionCode=40\b", adb("shell", "dumpsys", "package", PACKAGE))
    prefs = et.fromstring(adb("shell", "run-as", PACKAGE, "cat", package_prefs))
    assert prefs.findtext("./string[@name='marcador']") == marker
    print("Atualização 39 → 40 com certificado descartável preservou o marcador.", flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
