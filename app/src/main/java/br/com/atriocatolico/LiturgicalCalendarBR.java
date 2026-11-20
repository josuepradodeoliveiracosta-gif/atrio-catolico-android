package br.com.atriocatolico;

import java.time.*;
import java.time.temporal.ChronoUnit;

/** National UI calendar, edition documented in the supplied plan, pp. 12–13. No network. */
final class LiturgicalCalendarBR {
    static final String REVISION = "BR-2026-11-18 / 2027 · GCatholic Brasil e SeuTom; Diretório CNBB pendente";
    enum Season {
        ATRIO("Aparência do Átrio", "Paz e bem!"), ADVENT("Advento", "Que a esperança prepare nosso coração."),
        CHRISTMAS("Natal", "Celebremos a alegria da Encarnação."), ORDINARY("Tempo Comum", "Sigamos Cristo nas pequenas escolhas de hoje."),
        LENT("Quaresma", "Abramos espaço para a oração e a conversão."), TRIDUUM("Tríduo Pascal", "Permaneçamos em oração e silêncio."),
        EASTER("Tempo Pascal", "Cristo ressuscitou! Aleluia!");
        final String title, message;
        Season(String title, String message) { this.title = title; this.message = message; }
    }
    static final class Span {
        final LocalDate start,end; final Season season;
        Span(String a,String b,Season s) { start=LocalDate.parse(a); end=LocalDate.parse(b); season=s; }
    }
    static final Span[] TABLE = {
        new Span("2026-11-18","2026-11-28",Season.ORDINARY), new Span("2026-11-29","2026-12-24",Season.ADVENT),
        new Span("2026-12-25","2027-01-10",Season.CHRISTMAS), new Span("2027-01-11","2027-02-09",Season.ORDINARY),
        new Span("2027-02-10","2027-03-25",Season.LENT), new Span("2027-03-26","2027-03-27",Season.TRIDUUM),
        new Span("2027-03-28","2027-05-16",Season.EASTER), new Span("2027-05-17","2027-11-27",Season.ORDINARY),
        new Span("2027-11-28","2027-12-24",Season.ADVENT), new Span("2027-12-25","2027-12-31",Season.CHRISTMAS)
    };
    static final class Day {
        final Season season; final String feast; final boolean red; final int candles;
        Day(Season s,String f,boolean r,int c) {season=s; feast=f; red=r; candles=c;}
    }
    static Day day(LocalDate date) {return day(date,TABLE);}
    static Day day(LocalDate date, Span[] spans) {
        Span matched=null;
        for(Span s:spans) if(!date.isBefore(s.start) && !date.isAfter(s.end)) {
            if(matched!=null && matched.season!=s.season) return new Day(Season.ATRIO,"",false,0);
            matched=s;
        }
        if(matched==null) return new Day(Season.ATRIO,"",false,0);
        String feast=""; boolean red=false;
        switch(date.toString()) {
            case "2026-12-25": case "2027-12-25": feast="Natal do Senhor"; break;
            case "2027-01-03": feast="Epifania do Senhor"; break;
            case "2027-01-10": feast="Batismo do Senhor"; break;
            case "2027-02-10": feast="Quarta-feira de Cinzas"; break;
            case "2027-03-21": feast="Domingo de Ramos"; red=true; break;
            case "2027-03-25": feast="Quinta-feira Santa"; break;
            case "2027-03-26": feast="Sexta-feira da Paixão"; red=true; break;
            case "2027-03-27": feast="Sábado Santo"; break;
            case "2027-03-28": feast="Domingo da Ressurreição"; break;
            case "2027-04-05": feast="Anunciação do Senhor"; break;
            case "2027-05-09": feast="Ascensão do Senhor"; break;
            case "2027-05-16": feast="Pentecostes"; red=true; break;
            default: break; // Sem celebração confirmada: manter apenas o tempo.
        }
        int candles=matched.season==Season.ADVENT ? Math.min(4,1+(int)ChronoUnit.WEEKS.between(matched.start,date)) : 0;
        return new Day(matched.season,feast,red,candles);
    }
    static String greeting(int hour) {return hour<5 || hour>=18 ? "Boa noite" : hour<12 ? "Bom dia" : "Boa tarde";}
    static ZonedDateTime nextChange(ZonedDateTime now) {
        LocalDate date=now.toLocalDate();
        ZonedDateTime next=date.plusDays(1).atStartOfDay(now.getZone());
        for(int h:new int[]{5,12,18}) {
            ZonedDateTime boundary=date.atTime(h,0).atZone(now.getZone());
            if(boundary.isAfter(now) && boundary.isBefore(next)) next=boundary;
        }
        java.time.zone.ZoneOffsetTransition t=now.getZone().getRules().nextTransition(now.toInstant());
        return t!=null && t.getInstant().isBefore(next.toInstant()) ? t.getInstant().atZone(now.getZone()) : next;
    }
}
