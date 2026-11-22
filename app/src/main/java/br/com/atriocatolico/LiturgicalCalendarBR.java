package br.com.atriocatolico;

import java.time.*;
import java.time.temporal.ChronoUnit;

/** Calendário temático brasileiro do rito romano, calculado offline. */
final class LiturgicalCalendarBR {
    static final String REVISION = "BR · calendário temático anual";
    enum Season {
        ATRIO("Aparência do Átrio", "Paz e bem!"), ADVENT("Advento", "Que a esperança prepare nosso coração."),
        CHRISTMAS("Natal", "Celebremos a alegria da Encarnação."), ORDINARY("Tempo Comum", "Sigamos Cristo nas pequenas escolhas de hoje."),
        LENT("Quaresma", "Abramos espaço para a oração e a conversão."), TRIDUUM("Tríduo Pascal", "Permaneçamos em oração e silêncio."),
        EASTER("Tempo Pascal", "Cristo ressuscitou! Aleluia!");
        final String title, message;
        Season(String title, String message) { this.title = title; this.message = message; }
    }
    static final class Day {
        final Season season; final String feast; final boolean red; final int candles;
        Day(Season s,String f,boolean r,int c) {season=s; feast=f; red=r; candles=c;}
    }
    static Day day(LocalDate date) {
        int year = date.getYear();
        LocalDate christmas = LocalDate.of(year, 12, 25);
        LocalDate advent = LocalDate.of(year, 11, 27)
            .with(java.time.temporal.TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY));
        LocalDate epiphany = LocalDate.of(year, 1, 2)
            .with(java.time.temporal.TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY));
        LocalDate baptism = epiphany.getDayOfMonth() >= 7 ? epiphany.plusDays(1) : epiphany.plusWeeks(1);
        LocalDate easter = easterSunday(year);
        LocalDate ashes = easter.minusDays(46);
        LocalDate pentecost = easter.plusWeeks(7);
        LocalDate annunciation = LocalDate.of(year, 3, 25);
        if (!annunciation.isBefore(easter.minusWeeks(1)) && !annunciation.isAfter(easter.plusWeeks(1))) {
            annunciation = easter.plusDays(8);
        } else if (annunciation.getDayOfWeek() == DayOfWeek.SUNDAY) {
            annunciation = annunciation.plusDays(1);
        }

        if (!date.isBefore(christmas) || !date.isAfter(baptism))
            return new Day(Season.CHRISTMAS, date.equals(christmas) ? "Natal do Senhor" :
                date.equals(epiphany) ? "Epifania do Senhor" : date.equals(baptism) ? "Batismo do Senhor" : "", false, 0);
        if (!date.isBefore(advent))
            return new Day(Season.ADVENT, "", false, 1 + (int) ChronoUnit.WEEKS.between(advent, date));
        long offset = ChronoUnit.DAYS.between(easter, date);
        if (!date.isBefore(ashes) && offset <= -3) {
            String feast = offset == -46 ? "Quarta-feira de Cinzas" :
                offset == -7 ? "Domingo de Ramos" : offset == -3 ? "Quinta-feira Santa" :
                date.equals(annunciation) ? "Anunciação do Senhor" : "";
            return new Day(Season.LENT, feast, offset == -7, 0);
        }
        if (offset == -2 || offset == -1)
            return new Day(Season.TRIDUUM, offset == -2 ? "Sexta-feira da Paixão" : "Sábado Santo", offset == -2, 0);
        if (offset >= 0 && !date.isAfter(pentecost)) {
            String feast = offset == 0 ? "Domingo da Ressurreição" :
                offset == 42 ? "Ascensão do Senhor" : offset == 49 ? "Pentecostes" :
                date.equals(annunciation) ? "Anunciação do Senhor" : "";
            return new Day(Season.EASTER, feast, offset == 49, 0);
        }
        return new Day(Season.ORDINARY, "", false, 0);
    }

    // Computus gregoriano de Meeus/Jones/Butcher.
    private static LocalDate easterSunday(int year) {
        int cycle = Math.floorMod(year, 19);
        int century = Math.floorDiv(year, 100);
        int yearInCentury = Math.floorMod(year, 100);
        int leapCenturies = Math.floorDiv(century, 4);
        int moonCorrection = Math.floorDiv(century - Math.floorDiv(century + 8, 25) + 1, 3);
        int moon = Math.floorMod(19 * cycle + century - leapCenturies - moonCorrection + 15, 30);
        int weekday = Math.floorMod(32 + 2 * Math.floorMod(century, 4) + 2 * (yearInCentury / 4)
            - moon - yearInCentury % 4, 7);
        int correction = (cycle + 11 * moon + 22 * weekday) / 451;
        int marchBased = moon + weekday - 7 * correction + 114;
        return LocalDate.of(year, marchBased / 31, marchBased % 31 + 1);
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
